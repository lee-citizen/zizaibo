/**
 * 连接直播（M1：抖音）辅助工具
 *
 * 弹幕采集思路：弹出独立直播间窗口后，把一段自包含、幂等的采集脚本
 * 注入到窗口的所有 frame（经主进程 WebFrameMain 穿透跨域 iframe）。
 * 脚本内用 MutationObserver 盯弹幕列表 DOM，把新消息写进缓冲区，
 * 每次执行脚本都会返回缓冲区内容供宿主轮询拉取。
 *
 * 性能要点：
 * - 只在抖音相关 frame 里安装采集器，无关 iframe 直接空转返回
 * - MutationObserver 只监听 childList（不开 characterData，避免事件风暴），
 *   回调内批处理 + 250ms 节流
 * - 人数扫描只在主 frame、10 秒一次
 * - React props 挖掘限制深度，且只在新条目上执行
 */

/** 采集脚本：执行一次 = 安装采集器（首次）+ 返回一轮新增数据 */
export const DANMAKU_INSTALL_SCRIPT = String.raw`(function () {
  // 无关 frame 直接空转（广告/统计 iframe），不做任何 DOM 扫描
  if (!/douyin\.com|webcast|amemv/i.test(location.href)) return null;
  var isTop = false;
  try { isTop = window.top === window; } catch (e) { isTop = false; }

  var st = window.__lt;
  if (!st) {
    st = window.__lt = {
      buf: [],
      seen: {},
      viewer: '',
      ready: false,
      lastMsgAt: 0,
      mo: null,
      scanTimer: null,
      viewerTimer: null,
      pendingNodes: [],
      flushTimer: null,
      hookedUrls: [],
      enterUrl: '',
      emojiMap: {},
      lastEnterResp: null
    };

    function pick(el, sels) {
      for (var i = 0; i < sels.length; i++) {
        try {
          var n = el.querySelector(sels[i]);
          if (n) return n;
        } catch (e) {}
      }
      return null;
    }

    /** 从 React props 里一次挖全 uid / level（抖音自己解析好的 user 对象，最准） */
    function isUserObj(u) {
      return (
        u &&
        typeof u === 'object' &&
        (u.sec_uid || u.secUid || u.user_id_str || u.uid || u.id != null)
      );
    }

    function badgeUrl(b) {
      if (!b) return '';
      if (b.url) return String(b.url);
      if (b.image && b.image.url_list && b.image.url_list.length) return String(b.image.url_list[0]);
      if (b.image && b.image.url) return String(b.image.url);
      return '';
    }

    /** 从抖音 user 对象提取头像 URL（优先 thumb，兜底 medium/large） */
    function avatarUrl(u) {
      if (!u) return '';
      var sources = [u.avatar_thumb, u.avatar_medium, u.avatar_large, u.avatar];
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s && Array.isArray(s.url_list) && s.url_list.length) return String(s.url_list[0]);
        if (s && s.url_list && typeof s.url_list === 'string') return String(s.url_list);
      }
      return '';
    }

    /** 根据 webcast 消息 method 分类事件类型 */
    function classifyEvent(method) {
      if (!method || typeof method !== 'string') return 'comment';
      if (method.indexOf('Gift') >= 0) return 'gift';
      if (method.indexOf('Member') >= 0) return 'entry';
      if (method.indexOf('Like') >= 0) return 'like';
      if (method.indexOf('Social') >= 0) return 'follow';
      return 'comment';
    }

    function fillUser(u, out) {
      if (!isUserObj(u)) return;
      if (!out.uid) {
        if (u.secUid) out.uid = String(u.secUid);
        else if (u.sec_uid) out.uid = String(u.sec_uid);
        else if (u.user_id_str) out.uid = String(u.user_id_str);
        else if (u.uid) out.uid = String(u.uid);
        else if (u.id != null) out.uid = String(u.id);
      }
      // 从 badge_image_list 提取等级图、粉丝团图（直接显示图片徽章）
      if (!out.levelImg || !out.fansImg) {
        var blist = Array.isArray(u.badge_image_list) ? u.badge_image_list : [];
        for (var i = 0; i < blist.length; i++) {
          var b = blist[i] || {};
          var url = badgeUrl(b);
          if (!url) continue;
          if (!out.levelImg && /grade_level|user_grade/i.test(url)) out.levelImg = url;
          if (!out.fansImg && /fansclub|fans_club/i.test(url)) out.fansImg = url;
        }
      }
      if (!out.level) {
        var lv =
          u.level != null ? u.level : u.user_level != null ? u.user_level : u.userLevel != null ? u.userLevel : u.grade != null ? u.grade : null;
        // 抖音荣誉等级在 badge_image_list[0].content.level（图片勋章自带的等级数字）
        if (lv == null && Array.isArray(u.badge_image_list) && u.badge_image_list.length) {
          var b0 = u.badge_image_list[0] || {};
          if (b0.content && b0.content.level != null) lv = b0.content.level;
        }
        if (lv == null && Array.isArray(u.badge_image_list_v2) && u.badge_image_list_v2.length) {
          var bv = u.badge_image_list_v2[0] || {};
          if (bv.content && bv.content.level != null) lv = bv.content.level;
        }
        if (lv != null && !isNaN(Number(lv)) && Number(lv) > 0) out.level = String(Number(lv));
      }
    }

    function digUserFields(obj, depth, out) {
      if (!obj || typeof obj !== 'object' || depth > 3) return;
      // props 自身就是 user 对象（组件直接接收 user 传参）
      if (isUserObj(obj)) fillUser(obj, out);
      if (out.uid && out.level) return;
      // 常见包裹形态
      fillUser(obj.user, out);
      fillUser(obj.author, out);
      fillUser(obj.sender, out);
      if (out.uid && out.level) return;
      for (var k in obj) {
        if (typeof obj[k] === 'object' && obj[k]) {
          digUserFields(obj[k], depth + 1, out);
          if (out.uid && out.level) return;
        }
      }
    }

    /** 找元素上的 React props；条目自身没有时向上找祖先（React 组件根）最多 3 层 */
    function reactPropsDeep(el) {
      var cur = el;
      for (var i = 0; i < 4 && cur; i++) {
        try {
          var keys = Object.keys(cur);
          for (var j = 0; j < keys.length; j++) {
            if (keys[j].indexOf('__reactProps$') === 0) return cur[keys[j]];
          }
        } catch (e) {}
        cur = cur.parentElement;
      }
      return null;
    }

    /** 富文本提取：把 emoji <img> 转成其 alt/aria-label/title，其余递归取文本 */
    function richText(el) {
      var out = '';
      var children = el.childNodes;
      for (var i = 0; i < children.length; i++) {
        var n = children[i];
        if (n.nodeType === 3) {
          out += n.nodeValue || '';
        } else if (n.nodeType === 1) {
          if (n.tagName === 'IMG') {
            out +=
              n.getAttribute('alt') || n.getAttribute('aria-label') || n.getAttribute('title') || '[表情]';
          } else if (n.tagName === 'BR') {
            out += ' ';
          } else {
            out += richText(n);
          }
        }
      }
      return out;
    }

    /** 递归找 React 树里的消息对象 { method, payload }（真实结构：props.children.props.message） */
    function findMessage(obj, depth) {
      // 从外层 item 的 props 到 message 需穿过 children→props→children→props→message，至少 5 层
      if (!obj || typeof obj !== 'object' || depth > 8) return null;
      if (typeof obj.method === 'string' && obj.payload && typeof obj.payload === 'object') return obj;
      var chain = [obj.message, obj.props, obj.children];
      for (var i = 0; i < chain.length; i++) {
        var r0 = findMessage(chain[i], depth + 1);
        if (r0) return r0;
      }
      for (var k in obj) {
        var v = obj[k];
        if (v && typeof v === 'object') {
          var r = findMessage(v, depth + 1);
          if (r) return r;
        }
      }
      return null;
    }

    var CHAT_METHODS = { WebcastChatMessage: 1, WebcastScreenChatMessage: 1, WebcastEmojiChatMessage: 1, WebcastGiftMessage: 1 };

    /** 收集弹幕里的 emoji 表情图（alt 标记 -> 图片地址），供渲染层把 [标记] 还原成图 */
    function collectEmoji(node) {
      try {
        if (Object.keys(st.emojiMap).length > 200) return;
        var imgs = node.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var alt =
            imgs[i].getAttribute('alt') || imgs[i].getAttribute('aria-label') || imgs[i].getAttribute('title') || '';
          var src = imgs[i].getAttribute('src') || '';
          if (alt && src && alt.length <= 12) {
            var k = alt.replace(/[\[\]]/g, '');
            if (k && !st.emojiMap[k]) st.emojiMap[k] = src;
          }
        }
      } catch (e) {}
    }

    /** 结构定位昵称元素：content 前面的兄弟节点（抖音昵称哈希 class 无关键词，靠位置找） */
    function findNickEl(node, cEl) {
      // 1) 常见带关键词的 class
      var byClass = pick(node, ['[class*="nickname"]', '[class*="name"]']);
      if (byClass) return byClass;
      // 2) content 的前一个元素兄弟（昵称 span 紧挨着 content）
      try {
        if (cEl) {
          var sib = cEl.previousElementSibling;
          while (sib) {
            if (sib.tagName === 'SPAN' || sib.tagName === 'A') return sib;
            sib = sib.previousElementSibling;
          }
        }
      } catch (e) {}
      return null;
    }

    function parseItem(node) {
      collectEmoji(node);
      // 直接取整条弹幕 DOM 的 innerHTML（徽章+昵称+内容+emoji 全都有），只补样式
      var wrap = node.querySelector ? node.querySelector('.webcast-chatroom___item-wrapper') : null;
      var html = wrap ? wrap.innerHTML : (node.innerHTML || '');
      if (!html) return null;
      // 纯文本（去重用）
      var text = (node.textContent || '').trim();
      if (!text || text.length > 300) return null;
      // 暂不过滤类型（小主播无性能压力），聊天/礼物/进场等全部接收，后续按需收紧
      // uid：从昵称链接 href 提取
      var uid = '';
      try {
        var a = node.querySelector ? node.querySelector('a[href*="/user/"]') : null;
        if (a) {
          var href = a.getAttribute('href') || '';
          var mm = href.match(/\/user\/([A-Za-z0-9_\-]+)/);
          if (mm) uid = mm[1];
        }
      } catch (e) {}
      // 昵称：冒号前的文本（html 里已包含，这里仅用于备用展示）
      var user = '';
      var nm = text.match(/^([^：:\n]{1,30})[：:]/);
      if (nm) user = nm[1].trim();

      // 头像 / 事件类型 / 礼物名 / 礼物数量：从 React props 里挖 message 对象
      var avatar = '', event = 'comment', giftName = '', giftCount = 0;
      try {
        var props = reactPropsDeep(node);
        var msgObj = props ? findMessage(props, 0) : null;
        if (msgObj) {
          event = classifyEvent(msgObj.method);
          var payload = msgObj.payload || {};
          // 优先级：payload.user（礼物/进场等）→ payload.sender（聊天）
          var u = payload.user || payload.sender || payload.to_user || null;
          avatar = avatarUrl(u);
          // uid 兜底：React props 里的 user 比 DOM href 更全
          if (!uid && u) {
            if (u.secUid) uid = String(u.secUid);
            else if (u.sec_uid) uid = String(u.sec_uid);
            else if (u.user_id_str) uid = String(u.user_id_str);
            else if (u.uid) uid = String(u.uid);
            else if (u.id != null) uid = String(u.id);
          }
          // 昵称兜底
          if (!user && u && u.nickname) user = String(u.nickname);
          if (event === 'gift') {
            if (payload.gift) {
              giftName = payload.gift.name ? String(payload.gift.name) : '';
              giftCount = payload.gift.count ? Number(payload.gift.count) : 0;
            }
            // 部分版本数量在 payload 顶层
            if (!giftCount && payload.count) giftCount = Number(payload.count);
          }
        }
      } catch (e) {}

      return {
        user: user,
        uid: uid,
        level: '',
        levelImg: '',
        fansImg: '',
        text: text,
        html: html,
        ts: Date.now(),
        avatar: avatar,
        event: event,
        giftName: giftName,
        giftCount: giftCount
      };
    }

    function pushMsg(m) {
      var minute = Math.floor(m.ts / 60000);
      // 同一分钟内相同内容只收一条：外层 item 与内层 wrapper 会被双层解析，靠这里兜底去重
      var key = m.text + '|' + minute;
      if (st.seen[key]) return;
      st.seen[key] = m.ts;
      st.buf.push(m);
      st.lastMsgAt = m.ts;
      if (st.buf.length > 300) st.buf.splice(0, st.buf.length - 300);
      var cutoff = Date.now() - 600000;
      for (var k in st.seen) {
        if (st.seen[k] < cutoff) delete st.seen[k];
      }
    }

    /** 批处理入口：先收节点，250ms 节流后统一解析，削峰 MutationObserver 事件 */
    function queueNodes(targets) {
      for (var i = 0; i < targets.length; i++) {
        if (st.pendingNodes.indexOf(targets[i]) === -1) st.pendingNodes.push(targets[i]);
      }
      if (st.flushTimer) return;
      st.flushTimer = setTimeout(function () {
        st.flushTimer = null;
        var list = st.pendingNodes;
        st.pendingNodes = [];
        // done 存 { node, msg }，嵌套去重时保留信息更全（有 uid）的那条
        var done = [];
        for (var i = 0; i < list.length; i++) {
          try {
            var node = list[i];
            if (!node.isConnected) continue;
            // 批内嵌套去重：外层 item 与内层 wrapper 常同时入队
            var nestedIdx = -1;
            for (var j = 0; j < done.length; j++) {
              var d = done[j];
              if (d.node.contains(node) || node.contains(d.node)) {
                nestedIdx = j;
                break;
              }
            }
            var m = parseItem(node);
            if (!m) continue;
            if (nestedIdx >= 0) {
              // 已有嵌套节点：若当前消息信息更全（有 uid）则替换，否则跳过
              var existing = done[nestedIdx].msg;
              if (!existing.uid && m.uid) {
                // 替换：先撤回旧消息（从 buf 移除），再 push 新的
                var buf = st.buf;
                for (var k = buf.length - 1; k >= 0; k--) {
                  if (buf[k] === existing) { buf.splice(k, 1); break; }
                }
                pushMsg(m);
                done[nestedIdx] = { node: node, msg: m };
              }
              continue;
            }
            pushMsg(m);
            done.push({ node: node, msg: m });
          } catch (e) {}
        }
      }, 250);
    }

    function bindList(list) {
      if (st.mo) {
        try { st.mo.disconnect(); } catch (e) {}
      }
      st.mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var mu = muts[i];
          var added = mu.addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches('[class*="item"]')) queueNodes([n]);
            try {
              var inner = n.querySelectorAll('[class*="item"]');
              if (inner.length) queueNodes(Array.prototype.slice.call(inner));
            } catch (e) {}
          }
        }
      });
      st.mo.observe(list, { childList: true, subtree: true });
      st.ready = true;
      // 绑定时把屏幕上已有的最近几条灌入
      try {
        var items = list.querySelectorAll('[class*="item"]');
        var start = Math.max(0, items.length - 8);
        for (var i = start; i < items.length; i++) {
          var m0 = parseItem(items[i]);
          if (m0) pushMsg(m0);
        }
      } catch (e) {}
    }

    function findList() {
      var sels = [
        '[data-e2e="chatroom-list"]',
        '[class*="chatroom___list"]',
        '[class*="chatroom"][class*="list"]',
        '[class*="chat-list"]'
      ];
      for (var i = 0; i < sels.length; i++) {
        try {
          var el = document.querySelector(sels[i]);
          if (el) return el;
        } catch (e) {}
      }
      return null;
    }

    // 容器发现：最多扫 20 次（约 24 秒）就放弃，避免无关 frame 永久轮询
    var scanLeft = 20;
    st.scanTimer = setInterval(function () {
      if (st.ready || scanLeft-- <= 0) {
        clearInterval(st.scanTimer);
        return;
      }
      var list = findList();
      if (list) bindList(list);
    }, 1200);

    // ---------- 观看人数：hook fetch/XHR 拦截 webcast 接口（准确、零轮询），DOM 扫描仅兜底 ----------
    function fmtCount(n) {
      if (n >= 10000) {
        var w = (n / 10000).toFixed(1);
        return (w.indexOf('.0') === w.length - 2 ? w.slice(0, -2) : w) + '\u4e07';
      }
      return String(n);
    }

    /** 从接口 JSON 里递归找观看数字段 */
    function digCount(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 6) return 0;
      var keys = [
        'user_count', 'watch_count', 'watching_count', 'total_user',
        'audience_count', 'viewerCount', 'user_count_str',
        'total_user_count', 'room_user_count', 'user_num',
        'online_count', 'current_user', 'current_count',
        'real_visitor_count', 'visitor_count'
      ];
      for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (v != null && !isNaN(Number(v)) && Number(v) > 0) return Number(v);
      }
      // user_count 可能是 { total, current } 对象
      if (obj.user_count && typeof obj.user_count === 'object') {
        var uc = obj.user_count;
        var n = Number(uc.current) || Number(uc.total) || Number(uc.total_user) || 0;
        if (n > 0) return n;
      }
      for (var k in obj) {
        if (typeof obj[k] === 'object' && obj[k]) {
          var r = digCount(obj[k], depth + 1);
          if (r) return r;
        }
      }
      return 0;
    }

    function parseCountStr(s) {
      // 解析 "22w+"、"1.2万"、"3亿" 等格式化人数
      if (!s || typeof s !== 'string') return 0;
      s = s.trim().replace(/[,+]/g, '');
      var m = s.match(/^([\d.]+)\s*([万亿wW])?$/);
      if (!m) return Number(s) || 0;
      var base = parseFloat(m[1]);
      if (!m[2]) return base;
      var unit = m[2].toLowerCase();
      if (unit === 'w' || unit === '万') return base * 10000;
      if (unit === '亿') return base * 100000000;
      return base;
    }

    function sniffStats(j, authoritative) {
      // authoritative=true 时无条件更新（enter 接口）；false 时仅在无值时兜底，
      // 防止 interaction/ranklist 等接口的"互动人数/送礼人数"(常为 1)覆盖真实观看人数
      if (authoritative) {
        try { st.lastEnterResp = j; } catch (e) {}
      }
      if (!authoritative && st.viewer) return;
      try {
        var d = j && j.data;
        if (!d) return;
        // 抖音 enter 接口真实结构：data.data 是数组，元素含 user_count_str / room_view_stats
        var arr = Array.isArray(d.data) ? d.data : null;
        if (arr && arr.length) {
          var r0 = arr[0];
          // 优先用数字字段 room_view_stats.display_value
          var stats = r0.room_view_stats || r0.stats;
          if (stats) {
            var nd = Number(stats.display_value) || Number(stats.user_count) || Number(stats.total) || 0;
            if (nd > 0) { st.viewer = fmtCount(nd); return; }
          }
          // 兜底：解析格式化字符串 user_count_str（如 "22w+"）
          if (typeof r0.user_count_str === 'string' && r0.user_count_str) {
            var pn = parseCountStr(r0.user_count_str);
            if (pn > 0) { st.viewer = fmtCount(pn); return; }
            st.viewer = r0.user_count_str.replace(/\s+/g, '');
            return;
          }
        }
        // 旧结构兼容：data.user_count.total / current
        var uc = d.user_count;
        if (uc) {
          var n0 = Number(uc.total) || Number(uc.current) || Number(uc.total_user);
          if (n0 > 0) { st.viewer = fmtCount(n0); return; }
        }
        // data.room.user_count_str
        var room = d.room || d.room_info;
        if (room && typeof room.user_count_str === 'string' && room.user_count_str) {
          st.viewer = room.user_count_str.replace(/\s+/g, '');
          return;
        }
        if (room && typeof room.stats === 'object') {
          var rs = room.stats;
          var n1 = Number(rs.user_count) || Number(rs.current_user) || Number(rs.total_user) || 0;
          if (n1 > 0) { st.viewer = fmtCount(n1); return; }
        }
        var n = digCount(j, 0);
        if (n > 0) st.viewer = fmtCount(n);
      } catch (e) {}
    }

    /** 记录 hook 到的 webcast 接口 URL（诊断用） */
    function recordUrl(u) {
      if (st.hookedUrls.indexOf(u) === -1) {
        st.hookedUrls.push(u);
        if (st.hookedUrls.length > 30) st.hookedUrls.shift();
      }
    }

    if (isTop) {
      // hook fetch
      try {
        var origFetch = window.fetch;
        if (origFetch) {
          window.fetch = function () {
            var url = arguments[0];
            if (url && typeof url === 'object' && url.url) url = url.url;
            var p = origFetch.apply(this, arguments);
            if (typeof url === 'string' && /webcast.*(room|im)/i.test(url)) {
              recordUrl(url);
              // 记录 enter 接口完整 URL，供定时重拉人数
              var isEnter = /\/webcast\/room\/web\/enter\//.test(url);
              if (isEnter) st.enterUrl = url;
              p.then(function (res) {
                try {
                  res.clone().json().then(function (j) { sniffStats(j, isEnter); }).catch(function () {});
                } catch (e) {}
              }).catch(function () {});
            }
            return p;
          };
        }
      } catch (e) {}
      // hook XHR
      try {
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, u) {
          try {
            if (typeof u === 'string' && /webcast.*(room|im)/i.test(u)) {
              recordUrl(u);
              var isEnterXhr = /\/webcast\/room\/web\/enter\//.test(u);
              this.addEventListener('load', function () {
                try { sniffStats(JSON.parse(this.responseText), isEnterXhr); } catch (e) {}
              });
            }
          } catch (e) {}
          return origOpen.apply(this, arguments);
        };
      } catch (e) {}

      // DOM 扫描兜底：30 秒一次（hook 拦不到时才起作用）
      var scanViewer = function () {
        try {
          if (st.viewer) return;
          var txt = '';
          var el = document.querySelector(
            '[data-e2e="room-participation-info"], [class*="participation"], [class*="watch"], [class*="audience"]'
          );
          if (el) txt = (el.textContent || '').trim();
          if (!txt) {
            var xp = document.evaluate(
              "//*[contains(text(),'\u5728\u770b') or contains(text(),'\u89c2\u770b') or contains(text(),'\u4eba\u6570')]",
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );
            for (var i = xp.snapshotLength - 1; i >= 0; i--) {
              var node = xp.snapshotItem(i);
              var s = (node.textContent || '').trim();
              if (s && s.length < 40 && /\d/.test(s)) {
                txt = s;
                break;
              }
            }
          }
          if (txt && txt.length < 40) {
            var mv = txt.match(/([\d.]+\s*\u4e07)/);
            if (mv) {
              st.viewer = mv[1].replace(/\s+/g, '');
            } else {
              var mn = txt.match(/(\d{2,})/);
              if (mn) st.viewer = mn[1];
            }
          }
        } catch (e) {}
      };
      scanViewer();
      st.viewerTimer = setInterval(scanViewer, 30000);

      // 从页面 URL 提取房间号，构造 enter 接口 URL（脚本注入时 enter 可能已请求过，hook 不到）
      function buildEnterUrl() {
        try {
          var m = location.pathname.match(/\/(\d+)/);
          if (!m) return '';
          var rid = m[1];
          return 'https://live.douyin.com/webcast/room/web/enter/?aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN&enter_from=web_live&web_rid=' + rid;
        } catch (e) { return ''; }
      }

      function pullEnter() {
        var url = st.enterUrl || buildEnterUrl();
        if (!url) return;
        try {
          fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (j) { sniffStats(j, true); })
            .catch(function () {});
        } catch (e) {}
      }

      // 立即拉一次（解决首次注入时 enter 已请求过的问题），之后每 60 秒刷新
      pullEnter();
      st.viewerTimer2 = setInterval(pullEnter, 60000);
    }
  }

  // DOM 兜底：直接读 [data-e2e="live-room-audience"] 的人数文本（最可靠）
  try {
    var audEl = document.querySelector('[data-e2e="live-room-audience"]');
    if (audEl && audEl.textContent) {
      var t = audEl.textContent.trim();
      if (t) st.viewer = t;
    }
  } catch (e) {}

  return {
    msgs: st.buf.splice(0, st.buf.length),
    viewer: st.viewer,
    ready: st.ready,
    lastMsgAt: st.lastMsgAt,
    emojiMap: st.emojiMap
  };
})()`;

/**
 * 诊断脚本：收集真实直播间页面的结构信息，用于校准弹幕选择器。
 * 返回一段文本，渲染层收集后交给开发者分析。
 */
export const DANMAKU_DIAGNOSE_SCRIPT = String.raw`(async function () {
  var lines = [];
  function L(s) { lines.push(s); }
  var st = window.__lt;
  L('url: ' + location.href);
  L('hasCollector: ' + !!st);
  if (st) {
    L('ready: ' + st.ready + ' | bufLen: ' + st.buf.length + ' | lastMsgAt: ' + st.lastMsgAt + ' | viewer: ' + st.viewer);
    L('hookedUrls: ' + JSON.stringify((st.hookedUrls || []).slice(0, 15)));
    // 打印 enter 接口响应的人数相关字段
    if (st.lastEnterResp) {
      try {
        var d = st.lastEnterResp.data || {};
        L('enterResp.data.user_count: ' + JSON.stringify(d.user_count || null));
        L('enterResp.data.room.user_count_str: ' + JSON.stringify((d.room || {}).user_count_str || null));
        L('enterResp.data.room.stats: ' + JSON.stringify((d.room || {}).stats || null));
        // 打印 data 所有顶层 key 及值类型（定位人数真实字段）
        var allKeys = [];
        for (var k in d) {
          var v = d[k];
          var t = Array.isArray(v) ? 'array[' + v.length + ']' : (v === null ? 'null' : typeof v);
          var preview = (typeof v === 'object' && v !== null) ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
          allKeys.push(k + '(' + t + ')=' + preview);
        }
        L('enterResp.data keys: ' + allKeys.join(' || '));
        // 递归找 data 下所有数值 > 100 的字段路径（人数通常较大）
        var bigNums = [];
        function walk(obj, path, depth) {
          if (!obj || typeof obj !== 'object' || depth > 4) return;
          for (var kk in obj) {
            var vv = obj[kk];
            if (typeof vv === 'number' && vv > 100) bigNums.push(path + '.' + kk + '=' + vv);
            else if (typeof vv === 'string' && /^\d+$/.test(vv) && Number(vv) > 100) bigNums.push(path + '.' + kk + '=' + vv);
            else if (vv && typeof vv === 'object') walk(vv, path + '.' + kk, depth + 1);
          }
        }
        walk(d, 'data', 0);
        L('enterResp big number fields: ' + (bigNums.length ? bigNums.slice(0, 30).join(' | ') : 'none'));
      } catch (e) { L('enterResp dump error: ' + e.message); }
    } else {
      L('lastEnterResp: null (enter 接口未返回或未被捕获)');
    }
  }
  // 弹幕容器候选命中
  var sels = ['[data-e2e="chatroom-list"]', '[class*="chatroom___list"]', '[class*="chatroom"][class*="list"]', '[class*="chat-list"]'];
  var hit = null, hitSel = '';
  for (var i = 0; i < sels.length; i++) {
    try { var el = document.querySelector(sels[i]); if (el) { hit = el; hitSel = sels[i]; break; } } catch (e) {}
  }
  L('listSelectorHit: ' + (hitSel || '无'));
  if (hit) {
    L('containerHtml: ' + hit.outerHTML.slice(0, 300));
    var items = hit.querySelectorAll('[class*="item"]');
    L('itemCount: ' + items.length);
    for (var j = 0; j < Math.min(2, items.length); j++) {
      L('itemHtml[' + j + ']: ' + items[j].outerHTML.slice(0, 1500));
      var keys = Object.keys(items[j]);
      var rp = [];
      for (var k = 0; k < keys.length; k++) if (keys[k].indexOf('react') > -1) rp.push(keys[k]);
      L('reactKeys[' + j + ']: ' + JSON.stringify(rp));
      var props = null;
      for (var k2 = 0; k2 < keys.length; k2++) if (keys[k2].indexOf('__reactProps$') === 0) { props = items[j][keys[k2]]; break; }
      if (props) {
        try { L('propsJson[' + j + ']: ' + JSON.stringify(props).slice(0, 2000)); } catch (e) { L('propsJson[' + j + ']: [序列化失败]'); }
      }
    }
  } else {
    var all = document.querySelectorAll('[class*="chat"],[class*="comment"],[class*="barrage"],[class*="danmu"]');
    L('chatLikeCount: ' + all.length);
    for (var m = 0; m < Math.min(5, all.length); m++) {
      L('chatLike[' + m + ']: <' + all[m].tagName + ' class="' + all[m].className + '">');
    }
  }
  // 等级/徽章/粉丝团
  var grades = document.querySelectorAll('[class*="grade"],[class*="level"],[class*="badge"],[class*="fans"]');
  L('gradeLikeCount: ' + grades.length);
  if (grades.length) L('gradeSample: ' + grades[0].outerHTML.slice(0, 400));
  // 人数元素
  try {
    var xp = document.evaluate("//*[contains(text(),'\u5728\u770b') or contains(text(),'\u89c2\u770b') or contains(text(),'\u4eba\u6570')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    L('viewerTextCount: ' + xp.snapshotLength);
    for (var v = 0; v < Math.min(3, xp.snapshotLength); v++) {
      var node = xp.snapshotItem(v);
      L('viewerSample[' + v + ']: ' + node.outerHTML.slice(0, 300));
    }
  } catch (e) { L('viewerTextError: ' + e.message); }
  // 若无 enter 响应缓存，主动拉一次并打印关键字段
  if (!st || !st.lastEnterResp) {
    try {
      var mm = location.pathname.match(/\/(\d+)/);
      if (mm) {
        var eurl = 'https://live.douyin.com/webcast/room/web/enter/?aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN&enter_from=web_live&web_rid=' + mm[1];
        L('主动 fetch enter: ' + eurl);
        var er = await fetch(eurl);
        var ej = await er.json();
        var ed = ej.data || {};
        L('fetchEnter.data.user_count: ' + JSON.stringify(ed.user_count || null));
        L('fetchEnter.data.room.user_count_str: ' + JSON.stringify((ed.room || {}).user_count_str || null));
        L('fetchEnter.data.room.stats: ' + JSON.stringify((ed.room || {}).stats || null));
        var fAll = [];
        for (var fk in ed) {
          var fv = ed[fk];
          var ft = Array.isArray(fv) ? 'array[' + fv.length + ']' : (fv === null ? 'null' : typeof fv);
          var fp = (typeof fv === 'object' && fv !== null) ? JSON.stringify(fv).slice(0, 120) : String(fv).slice(0, 120);
          fAll.push(fk + '(' + ft + ')=' + fp);
        }
        L('fetchEnter.data keys: ' + fAll.join(' || '));
        var fBig = [];
        function fwalk(obj, path, depth) {
          if (!obj || typeof obj !== 'object' || depth > 4) return;
          for (var kk in obj) {
            var vv = obj[kk];
            if (typeof vv === 'number' && vv > 100) fBig.push(path + '.' + kk + '=' + vv);
            else if (typeof vv === 'string' && /^\d+$/.test(vv) && Number(vv) > 100) fBig.push(path + '.' + kk + '=' + vv);
            else if (vv && typeof vv === 'object') fwalk(vv, path + '.' + kk, depth + 1);
          }
        }
        fwalk(ed, 'data', 0);
        L('fetchEnter big number fields: ' + (fBig.length ? fBig.slice(0, 30).join(' | ') : 'none'));
      }
    } catch (e) { L('fetchEnter error: ' + e.message); }
  }
  return lines.join('\n');
})()`;

export type LivePlatform = "douyin";

export interface NormalizedRoom {
  ok: boolean;
  url?: string;
  platform?: LivePlatform;
  error?: string;
}

/** 归一化并校验直播间链接（M1 仅支持抖音） */
export function normalizeRoomUrl(raw: string): NormalizedRoom {
  const input = raw.trim();
  if (!input) return { ok: false, error: "请输入直播间链接" };
  const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    return { ok: false, error: "链接格式不正确" };
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith("douyin.com")) {
    return { ok: false, error: "暂仅支持抖音直播间链接（live.douyin.com/房间号）" };
  }
  const isLive =
    host.startsWith("live.") ||
    /^\/(live|enter)/.test(u.pathname) ||
    u.searchParams.has("enter_from");
  if (!isLive) {
    return {
      ok: false,
      error: "未识别到直播间地址，请粘贴 live.douyin.com/房间号 或直播间分享链接",
    };
  }
  return { ok: true, url: u.toString(), platform: "douyin" };
}

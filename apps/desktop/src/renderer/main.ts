import { createApp } from "vue";
import { createPinia } from "pinia";

import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "./styles/index.scss";
import "./styles/tailwind.css"; // 引入 Tailwind
import "./permission";
import App from "./App.vue";
import router from "./router";
import { errorHandler } from "./error";
import { useBgmStore } from "./store/modules/bgm";
import { useSpeechStore } from "./store/modules/speech";

import { i18n } from "./i18n";

const app = createApp(App);
const store = createPinia();
app.use(router);
// element-plus 2.x 的安装选项已不含 i18n，但保留原运行时行为
app.use(ElementPlus, { i18n: i18n.global.d } as any);
app.use(store);
app.use(i18n);
errorHandler(app);

// 全局背景音乐：应用启动即初始化音频单例与播放列表（路由切换不销毁）
useBgmStore(store).init();

// 智能朗读：加载系统语音列表与用户语音库（引导定时器随启用状态启动）
useSpeechStore(store).init();

app.mount("#app");

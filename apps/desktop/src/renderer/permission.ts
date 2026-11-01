import router from './router'
import { useAuthStore } from '@renderer/store/modules/auth'
import Performance from '@renderer/utils/performance'

var end: Function | null = null
router.beforeEach((to, from) => {
  end = Performance.startExecute(`${from.path} => ${to.path} 路由耗时`) /// 路由性能监控
  setTimeout(() => {
    end?.()
  }, 0)

  const auth = useAuthStore()
  // 未授权时，除卡密激活页外，其他页面一律拦截到激活页
  if (!auth.authorized && to.path !== '/key') {
    return '/key'
  }
  // 返回 undefined 即放行，无需再调用 next 回调
})

router.afterEach(() => {})

import { RouteRecordRaw } from 'vue-router'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@renderer/views/404.vue'),
  },
  {
    path: '/index',
    name: '直播主页',
    component: () => import('@renderer/views/index/index.vue'),
  },
  {
    path: '/games',
    name: '游戏大厅',
    component: () => import('@renderer/views/games/games.vue'),
  },
  {
    path: '/Browser',
    name: '浏览器',
    component: () => import('@renderer/views/Browser.vue'),
  },
]

export default routes

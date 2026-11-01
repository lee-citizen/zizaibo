import axios from 'axios'

const serves = axios.create({
  baseURL: __CONFIG__.BASE_API,
  timeout: 15000,
})

/** 模块级 token，由 auth store 在加载/激活/登出时同步 */
let authToken = ''

/** 供 auth store 设置当前 token */
export function setAuthToken(token: string) {
  authToken = token
}

// 设置请求发送之前的拦截器
serves.interceptors.request.use(
  (config) => {
    if (authToken) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${authToken}`
    }
    return config
  },
  (err) => Promise.reject(err),
)

// 设置请求接受拦截器
serves.interceptors.response.use(
  (res) => {
    return res
  },
  (err) => {
    if (err.message?.includes('timeout')) {
      console.log('请求超时', err)
    }
    if (err.message?.includes('Network Error')) {
      console.log('网络错误', err)
    }
    return Promise.reject(err)
  },
)

export default serves

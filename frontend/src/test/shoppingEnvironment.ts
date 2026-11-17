import { beforeEach, afterEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server'
import { setTokens, clearTokens } from '../api/tokenStorage'
export function shoppingEnvironment() {
 let previous: PropertyDescriptor | undefined
 beforeEach(() => {
  localStorage.clear(); setTokens('testuser_access', 'testuser_refresh')
  vi.stubGlobal('isSecureContext', true)
  previous=Object.getOwnPropertyDescriptor(navigator,'locks')
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name:string,_options:unknown,callback:()=>unknown)=>callback()}})
  server.use(http.get('/api/households/me',()=>HttpResponse.json({id:10})))
 })
 afterEach(()=>{clearTokens();vi.unstubAllGlobals();if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks')})
}

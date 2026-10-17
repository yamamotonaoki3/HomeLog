import { http, HttpResponse, type HttpHandler } from 'msw'

export const handlers: HttpHandler[] = [
  http.get('/api/auth/me', () => HttpResponse.json({ id: 1, displayName: 'testuser_me' })),
  http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ notificationCount: 0 })),
  http.get('/api/auth/account/deletion-check', () => HttpResponse.json({ canRequest: true, unsettledSplits: 0, fixedCostsWithOthers: 0 })),
]

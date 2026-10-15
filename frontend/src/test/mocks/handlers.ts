import { http, HttpResponse, type HttpHandler } from 'msw'

export const handlers: HttpHandler[] = [
  http.get('/api/auth/me', () => HttpResponse.json({ id: 1, displayName: 'testuser_me' })),
  http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ notificationCount: 0 })),
]

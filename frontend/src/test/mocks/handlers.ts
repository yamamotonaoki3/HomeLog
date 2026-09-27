import { http, HttpResponse, type HttpHandler } from 'msw'

export const handlers: HttpHandler[] = [
  http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ notificationCount: 0 })),
]

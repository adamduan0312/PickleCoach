import { apiRequest, qs } from './client.js';

export { ApiError, API_BASE_URL, asList, getStoredToken, setStoredToken, clearStoredToken, onUnauthorized } from './client.js';

export const authApi = {
  register: (body) => apiRequest('/auth/register', { method: 'POST', body, skipAuth: true, ignoreUnauthorized: true }),
  login: (body) => apiRequest('/auth/login', { method: 'POST', body, skipAuth: true, ignoreUnauthorized: true }),
  refresh: (token) => apiRequest('/auth/refresh', { method: 'POST', body: { token }, skipAuth: true, ignoreUnauthorized: true }),
  forgotPassword: (email) => apiRequest('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true }),
  resetPassword: (body) => apiRequest('/auth/reset-password', { method: 'POST', body, skipAuth: true }),
  getProfile: (opts) => apiRequest('/auth/profile', opts),
  updateProfile: (body) => apiRequest('/auth/profile', { method: 'PUT', body }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  addRole: (role) => apiRequest('/auth/me/role', { method: 'PUT', body: { role, action: 'add' } }),
  removeRole: (role) => apiRequest('/auth/me/role', { method: 'PUT', body: { role, action: 'remove' } }),
  changePassword: (body) => apiRequest('/auth/change-password', { method: 'PUT', body }),
  requestEmailChange: (body) => apiRequest('/auth/change-email/request', { method: 'POST', body }),
  confirmEmailChange: (token) => apiRequest('/auth/change-email/confirm', { method: 'POST', body: { token }, skipAuth: true }),
  requestEmailVerification: () => apiRequest('/auth/verify-email/request', { method: 'POST', body: {} }),
  confirmEmailVerification: (token) => apiRequest('/auth/verify-email/confirm', { method: 'POST', body: { token }, skipAuth: true }),
};

export const coachesApi = {
  list: (params) => apiRequest(`/coaches${qs(params)}`),
  getById: (id) => apiRequest(`/coaches/${id}`),
  getLessons: (id, params) => apiRequest(`/coaches/${id}/lessons${qs(params)}`),
  getCourts: (id, params) => apiRequest(`/coaches/${id}/courts${qs(params)}`),
  getAvailability: (id, params) => apiRequest(`/coaches/${id}/availability${qs(params)}`),
  getReviews: (id, params) => apiRequest(`/coaches/${id}/reviews${qs(params)}`),
  getReliability: (id) => apiRequest(`/coaches/${id}/reliability`),
  createProfile: (body) => apiRequest('/coaches/profile', { method: 'POST', body }),
  updateMyProfile: (body) => apiRequest('/coaches/me/profile', { method: 'PUT', body }),
  myCourts: (params) => apiRequest(`/coaches/me/courts${qs(params)}`),
  addCourt: (body) => apiRequest('/coaches/me/courts', { method: 'POST', body }),
  removeCourt: (courtId) => apiRequest(`/coaches/me/courts/${courtId}`, { method: 'DELETE' }),
  myLessons: (params) => apiRequest(`/coaches/me/lessons${qs(params)}`),
  myAvailability: (params) => apiRequest(`/coaches/me/availability${qs(params)}`),
  createAvailability: (body) => apiRequest('/coaches/me/availability', { method: 'POST', body }),
  updateAvailability: (id, body) => apiRequest(`/coaches/me/availability/${id}`, { method: 'PUT', body }),
  deleteAvailability: (id) => apiRequest(`/coaches/me/availability/${id}`, { method: 'DELETE' }),
  myBookings: (params) => apiRequest(`/coaches/me/bookings${qs(params)}`),
  myReviews: (params) => apiRequest(`/coaches/me/reviews${qs(params)}`),
  myReliability: () => apiRequest('/coaches/me/reliability'),
  marketplaceStatus: () => apiRequest('/coaches/me/marketplace-status'),
  stripeOnboard: () => apiRequest('/coaches/me/stripe-connect/onboard', { method: 'POST', body: {} }),
  stripeStatus: () => apiRequest('/coaches/me/stripe-connect/status'),
};

/** Server-side ZIP/city/address → coordinates for Discover (no provider keys in the browser). */
export const geoApi = {
  search: (params) => apiRequest(`/geo/search${qs(params)}`),
};

export const studentsApi = {
  myBookings: (params) => apiRequest(`/students/me/bookings${qs(params)}`),
  myReviews: (params) => apiRequest(`/students/me/reviews${qs(params)}`),
  myReliability: () => apiRequest('/students/me/reliability'),
};

export const lessonsApi = {
  getById: (id) => apiRequest(`/lessons/${id}`),
  create: (body) => apiRequest('/lessons', { method: 'POST', body }),
  update: (id, body) => apiRequest(`/lessons/${id}`, { method: 'PUT', body }),
  remove: (id) => apiRequest(`/lessons/${id}`, { method: 'DELETE' }),
};

export const courtsApi = {
  search: (params) => apiRequest(`/courts${qs(params)}`),
  getById: (id) => apiRequest(`/courts/${id}`),
  create: (body) => apiRequest('/courts', { method: 'POST', body }),
  duplicateCheck: (body) => apiRequest('/courts/duplicate-check', { method: 'POST', body }),
};

export const bookingsApi = {
  createIntent: (body, idempotencyKey) =>
    apiRequest('/booking-intents', {
      method: 'POST',
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  confirm: (payment_intent_id) =>
    apiRequest('/bookings/confirm', { method: 'POST', body: { payment_intent_id } }),
  getById: (id) => apiRequest(`/bookings/${id}`),
  accept: (id) => apiRequest(`/bookings/${id}/accept`, { method: 'PUT' }),
  decline: (id, body) => apiRequest(`/bookings/${id}/decline`, { method: 'PUT', body }),
  complete: (id, body) => apiRequest(`/bookings/${id}/complete`, { method: 'POST', body: body || {} }),
  studentNoShow: (id, body) => apiRequest(`/bookings/${id}/student-no-show`, { method: 'POST', body: body || {} }),
  cancel: (id, body) => apiRequest(`/bookings/${id}/cancel`, { method: 'POST', body }),
};

export const notificationsApi = {
  list: (params) => apiRequest(`/notifications${qs(params)}`),
  unreadCount: () => apiRequest('/notifications/unread-count'),
  markRead: (id) => apiRequest(`/notifications/${id}/read`, { method: 'PUT' }),
  remove: (id) => apiRequest(`/notifications/${id}`, { method: 'DELETE' }),
};

export const messagesApi = {
  conversations: (params) => apiRequest(`/messages/conversations${qs(params)}`),
  conversation: (id, params) => apiRequest(`/messages/conversations/${id}${qs(params)}`),
  createConversation: (booking_id) =>
    apiRequest('/messages/conversations', { method: 'POST', body: { booking_id } }),
  send: (body) => apiRequest('/messages/send', { method: 'POST', body }),
};

export const reviewsApi = {
  create: (body) => apiRequest('/reviews', { method: 'POST', body }),
};

export const disputesApi = {
  list: (params) => apiRequest(`/disputes${qs(params)}`),
  types: () => apiRequest('/disputes/types'),
  getById: (id) => apiRequest(`/disputes/${id}`),
  create: (body) => apiRequest('/disputes', { method: 'POST', body }),
  resolve: (id, body) => apiRequest(`/disputes/${id}/resolve`, { method: 'PUT', body }),
};

export const adminApi = {
  dashboard: () => apiRequest('/admin/dashboard'),
  users: (params) => apiRequest(`/users${qs(params)}`),
  user: (id) => apiRequest(`/users/${id}`),
  updateUser: (id, body) => apiRequest(`/users/${id}`, { method: 'PUT', body }),
  auditLogs: (params) => apiRequest(`/admin/audit-logs${qs(params)}`),
  bookings: (params) => apiRequest(`/admin/bookings${qs(params)}`),
  booking: (id) => apiRequest(`/admin/bookings/${id}`),
  cancelBooking: (id, body) => apiRequest(`/admin/bookings/${id}/cancel`, { method: 'POST', body }),
  refundBooking: (id, body) => apiRequest(`/admin/bookings/${id}/refund`, { method: 'POST', body }),
  studentNoShow: (id, body) => apiRequest(`/admin/bookings/${id}/student-no-show`, { method: 'POST', body: body || {} }),
  coachNoShow: (id, body) => apiRequest(`/admin/bookings/${id}/coach-no-show`, { method: 'POST', body: body || {} }),
};

export const paymentsApi = {
  list: (params) => apiRequest(`/payments${qs(params)}`),
  getById: (id) => apiRequest(`/payments/${id}`),
};

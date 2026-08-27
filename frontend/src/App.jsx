import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { GuestOnly, RequireAuth, RequireRole } from './auth/guards.jsx';
import { homePathFor } from './auth/paths.js';
import { AppShell } from './components/layout/AppShell.jsx';
import { LoadingState } from './components/ui/States.jsx';
import { LandingPage } from './pages/LandingPage.jsx';
import { LoginPage } from './pages/auth/LoginPage.jsx';
import { RegisterPage } from './pages/auth/RegisterPage.jsx';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage.jsx';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage.jsx';
import { ChangeEmailConfirmPage } from './pages/auth/ChangeEmailConfirmPage.jsx';
import { ForbiddenPage, NotFoundPage } from './pages/StatusPages.jsx';
import { StudentDashboardPage } from './pages/student/StudentDashboardPage.jsx';
import { DiscoverPage } from './pages/student/DiscoverPage.jsx';
import { CoachPublicProfilePage } from './pages/student/CoachPublicProfilePage.jsx';
import { BookingCheckoutPage } from './pages/student/BookingCheckoutPage.jsx';
import { BookingConfirmingPage } from './pages/student/BookingConfirmingPage.jsx';
import { BookingsListPage } from './pages/bookings/BookingsListPage.jsx';
import { BookingDetailPage } from './pages/bookings/BookingDetailPage.jsx';
import { CoachDashboardPage } from './pages/coach/CoachDashboardPage.jsx';
import { CoachProfileEditPage } from './pages/coach/CoachProfileEditPage.jsx';
import { CoachLessonsPage } from './pages/coach/CoachLessonsPage.jsx';
import { CoachAvailabilityPage } from './pages/coach/CoachAvailabilityPage.jsx';
import { CoachCourtsPage } from './pages/coach/CoachCourtsPage.jsx';
import { StripeConnectPage, StripeRefreshPage, StripeReturnPage } from './pages/coach/StripeConnectPage.jsx';
import { NotificationsPage } from './pages/notifications/NotificationsPage.jsx';
import { ConversationPage, ConversationsPage } from './pages/messages/MessagesPages.jsx';
import { SettingsPage } from './pages/settings/SettingsPage.jsx';
import {
  AdminBookingsPage,
  AdminDisputeDetailPage,
  AdminDisputesPage,
  AdminHomePage,
  AdminUserDetailPage,
  AdminUsersPage,
} from './pages/admin/AdminPages.jsx';

function ShellLayout() {
  return (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  );
}

function RootRedirect() {
  const { isAuthenticated, bootstrapping, user, mode } = useAuth();
  if (bootstrapping) return <LoadingState label="Loading…" />;
  if (isAuthenticated) return <Navigate to={homePathFor(user, mode)} replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/change-email/confirm" element={<ChangeEmailConfirmPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />

          <Route element={<ShellLayout />}>
            <Route path="/dashboard" element={<RequireRole roles={['student']}><StudentDashboardPage /></RequireRole>} />
            <Route path="/discover" element={<RequireRole roles={['student', 'coach', 'admin']}><DiscoverPage /></RequireRole>} />
            <Route path="/coaches/:id" element={<RequireRole roles={['student', 'coach', 'admin']}><CoachPublicProfilePage /></RequireRole>} />
            <Route path="/book/:coachId/checkout" element={<RequireRole roles={['student']}><BookingCheckoutPage /></RequireRole>} />
            <Route path="/bookings/confirming" element={<RequireRole roles={['student']}><BookingConfirmingPage /></RequireRole>} />
            <Route path="/bookings" element={<RequireRole roles={['student']}><BookingsListPage audience="student" /></RequireRole>} />
            <Route path="/bookings/:id" element={<BookingDetailPage />} />

            <Route path="/coach" element={<RequireRole roles={['coach']}><CoachDashboardPage /></RequireRole>} />
            <Route path="/coach/profile" element={<RequireRole roles={['coach']}><CoachProfileEditPage /></RequireRole>} />
            <Route path="/coach/lessons" element={<RequireRole roles={['coach']}><CoachLessonsPage /></RequireRole>} />
            <Route path="/coach/availability" element={<RequireRole roles={['coach']}><CoachAvailabilityPage /></RequireRole>} />
            <Route path="/coach/courts" element={<RequireRole roles={['coach']}><CoachCourtsPage /></RequireRole>} />
            <Route path="/coach/stripe" element={<RequireRole roles={['coach']}><StripeConnectPage /></RequireRole>} />
            <Route path="/coach/onboarding/return" element={<RequireRole roles={['coach']}><StripeReturnPage /></RequireRole>} />
            <Route path="/coach/onboarding/refresh" element={<RequireRole roles={['coach']}><StripeRefreshPage /></RequireRole>} />
            <Route path="/coach/bookings" element={<RequireRole roles={['coach']}><BookingsListPage audience="coach" /></RequireRole>} />

            <Route path="/messages" element={<ConversationsPage />} />
            <Route path="/messages/:id" element={<ConversationPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            <Route path="/admin" element={<RequireRole roles={['admin']}><AdminHomePage /></RequireRole>} />
            <Route path="/admin/users" element={<RequireRole roles={['admin']}><AdminUsersPage /></RequireRole>} />
            <Route path="/admin/users/:id" element={<RequireRole roles={['admin']}><AdminUserDetailPage /></RequireRole>} />
            <Route path="/admin/bookings" element={<RequireRole roles={['admin']}><AdminBookingsPage /></RequireRole>} />
            <Route path="/admin/bookings/:id" element={<RequireRole roles={['admin']}><BookingDetailPage admin /></RequireRole>} />
            <Route path="/admin/disputes" element={<RequireRole roles={['admin']}><AdminDisputesPage /></RequireRole>} />
            <Route path="/admin/disputes/:id" element={<RequireRole roles={['admin']}><AdminDisputeDetailPage /></RequireRole>} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

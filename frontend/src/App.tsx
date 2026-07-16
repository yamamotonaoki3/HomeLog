import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { AuthProvider } from './context/AuthContext'
import { RequireAuth } from './routes/RequireAuth'
import { RequireHousehold } from './routes/RequireHousehold'
import { DashboardPage } from './pages/DashboardPage'
import { HouseholdPage } from './pages/HouseholdPage'
import { LoginPage } from './pages/LoginPage'
import { PasswordResetPage } from './pages/PasswordResetPage'
import { RegisterPage } from './pages/RegisterPage'
import { ZaikoPage } from './pages/ZaikoPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/password-reset" element={<PasswordResetPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/household" element={<HouseholdPage />} />

            <Route element={<RequireHousehold />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/zaiko" element={<ZaikoPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

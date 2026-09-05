import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { AuthProvider } from './context/AuthContext'
import { RequireAuth } from './routes/RequireAuth'
import { RequireHousehold } from './routes/RequireHousehold'
import { AccountsPage } from './pages/AccountsPage'
import { DashboardPage } from './pages/DashboardPage'
import { EventsPage } from './pages/EventsPage'
import { FixedCostsPage } from './pages/FixedCostsPage'
import { HouseholdPage } from './pages/HouseholdPage'
import { HouseholdSettingsPage } from './pages/HouseholdSettingsPage'
import { KakeiboCategoriesPage } from './pages/KakeiboCategoriesPage'
import { KakeiboPage } from './pages/KakeiboPage'
import { LoginPage } from './pages/LoginPage'
import { MenuPage } from './pages/MenuPage'
import { PasswordResetPage } from './pages/PasswordResetPage'
import { RecipesPage } from './pages/RecipesPage'
import { RegisterPage } from './pages/RegisterPage'
import { WarikanPage } from './pages/WarikanPage'
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
                <Route path="/kakeibo" element={<KakeiboPage />} />
                <Route path="/warikan" element={<WarikanPage />} />
                <Route path="/fixed-costs" element={<FixedCostsPage />} />
                <Route path="/categories" element={<KakeiboCategoriesPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/recipes" element={<RecipesPage />} />
                <Route path="/recipes/share" element={<RecipesPage />} />
                <Route path="/menu" element={<MenuPage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/household/settings" element={<HouseholdSettingsPage />} />
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

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Routes, Route, useOutletContext } from "react-router-dom";
import DriverLayout from "./driverlayout";
import Dashboard from "./Dashboard";
import { isPessoalProfile } from "./profile-type";
import {
  ExpensesPage,
  HistoryPage,
  NotesPage,
  PerformancePage,
  PersonalDashboardPage,
  PersonalReceitasPage,
  PersonalResumoPage,
  ProfilePage,
  RegisterPage,
  SummaryPage,
  UsersPage,
} from "./Pages";

function HomeRoute() {
  const context = useOutletContext();
  return isPessoalProfile(context?.user?.profileType) ? <PersonalDashboardPage /> : <Dashboard />;
}

const root = createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/driver" replace />} />
        <Route path="/driver" element={<DriverLayout />}>
          <Route index element={<HomeRoute />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="summary" element={<SummaryPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="receitas" element={<PersonalReceitasPage />} />
          <Route path="resumo" element={<PersonalResumoPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/driver" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

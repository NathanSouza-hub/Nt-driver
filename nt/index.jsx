import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import DriverLayout from "./driverlayout";
import Dashboard from "./Dashboard";
import {
  ExpensesPage,
  HistoryPage,
  NotesPage,
  PerformancePage,
  ProfilePage,
  RegisterPage,
  SummaryPage,
  UsersPage,
} from "./Pages";

const root = createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/driver" replace />} />
        <Route path="/driver" element={<DriverLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="summary" element={<SummaryPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/driver" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

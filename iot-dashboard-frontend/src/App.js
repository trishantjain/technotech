import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import DashboardView from './pages/DashboardView';
import DashboardViewV2 from './pages/DashboardViewV2';
import AdminDashboard from './pages/AdminDashboard';
import PrivateRoute from './components/PrivateRoute';
import OfflinePrompt from './components/OfflinePrompt';
import AdminLayout from './pages/admin/AdminLayout';
import RegisteredDevices from './pages/admin/RegisteredDevices';
import RegisterDevice from './pages/admin/RegisterDevice';
import RegisteredUsers from './pages/admin/RegisteredUsers';
import AddUser from './pages/admin/AddUser';
import HistoricalDataTab from './pages/admin/HistoricalDataTab';
import ColorScheme from './pages/admin/ColorScheme';

const API = "/api";

function App() {
  const [offlinePrompt, setOfflinePrompt] = useState(false);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch(`${API}/ping`, { method: 'GET' });
        if (!res.ok) throw new Error('Offline');
        setOfflinePrompt(false);
      } catch (err) {
        setOfflinePrompt(true);
      }
    };

    checkConnection(); // check on load
    const interval = setInterval(checkConnection, 10000); // repeat every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <Router>
      <OfflinePrompt show={offlinePrompt} />
      <Routes>
        <Route path="/" element={<Login />} />

        {/* ✅ Authenticated User Dashboard */}
        <Route
          path="/dashboard"
          element={
            <PrivateRoute allowedRoles={['user', 'block', 'gp']}>
              <DashboardView />
            </PrivateRoute>
          }
        />

        <Route
          path="/dashboard-v2"
          element={
            <PrivateRoute allowedRoles={['user', 'block', 'gp']}>
              <DashboardViewV2 />
            </PrivateRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <PrivateRoute allowedRoles={["admin"]}>
              <AdminLayout />
            </PrivateRoute>
          }
        >
          <Route path="add-user" element={<AddUser />} />
          <Route path="registered-users" element={<RegisteredUsers />} />
          <Route path="register-device" element={<RegisterDevice />} />
          <Route path="registered-devices" element={<RegisteredDevices />} />
          <Route path="color-scheme" element={<ColorScheme />} />
          <Route path="dashboard" element={<DashboardView />} />
          <Route path="historical-data" element={<HistoricalDataTab />} />
        </Route>

        {/* ✅ Only Register Device Access */}
        <Route
          path="/register-device"
          element={
            <PrivateRoute allowedRoles={['field-worker']}>
              <RegisterDevice />
            </PrivateRoute>
          }
        />


        {/* ✅ Admin Dashboard */}
        {/* <Route
          path="/admin"
          element={
            <PrivateRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </PrivateRoute>
          }
        /> */}

        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;

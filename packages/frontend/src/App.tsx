import { Routes, Route, Navigate } from 'react-router-dom';
import { AnalysisListPage } from './pages/AnalysisListPage';
import { AnalysisDetailPage } from './pages/AnalysisDetailPage';
import { SubmitAnalysisPage } from './pages/SubmitAnalysisPage';
import { Layout } from './components/Layout';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/analyses" replace />} />
        <Route path="/analyses" element={<AnalysisListPage />} />
        <Route path="/analyses/:analysisId" element={<AnalysisDetailPage />} />
        <Route path="/submit" element={<SubmitAnalysisPage />} />
      </Route>
    </Routes>
  );
}

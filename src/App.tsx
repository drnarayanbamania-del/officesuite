import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import PdfViewer from './pages/PdfViewer';
import Presentation from './pages/Presentation';
import Spreadsheet from './pages/Spreadsheet';
import ToolPage from './pages/ToolPage';
import Writer from './pages/Writer';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/writer" element={<Writer />} />
        <Route path="/writer/:id" element={<Writer />} />
        <Route path="/sheet" element={<Spreadsheet />} />
        <Route path="/sheet/:id" element={<Spreadsheet />} />
        <Route path="/slides" element={<Presentation />} />
        <Route path="/slides/:id" element={<Presentation />} />
        <Route path="/pdf" element={<PdfViewer />} />
        <Route path="/pdf/:id" element={<PdfViewer />} />
        <Route path="/tools/:toolId" element={<ToolPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

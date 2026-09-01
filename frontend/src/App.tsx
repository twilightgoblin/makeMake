// -----------------------------------------------------------------------------
// Makemake — App root
//
// Owns routing. Each route is responsible for its own AudioPlayer instance.
//
// Routes:
//   /          — HomePage (lobby: create or join)
//   /solo      — SoloPage (single-player, the Phase 4 experience)
//   /room/:code — RoomPage (multi-player room)
// -----------------------------------------------------------------------------

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { SoloPage } from './pages/SoloPage';
import { RoomPage } from './pages/RoomPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/solo" element={<SoloPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        {/* Catch-all → home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

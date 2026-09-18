import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import Layout from './Layout.jsx';
import AuthScreen from './AuthScreen.jsx';
import AuctionTerminal from './AuctionTerminal.jsx';
import AssetList from './AssetList.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><AssetList /></Layout>} />
        <Route path="/assets" element={<Layout><AssetList /></Layout>} />
        <Route path="/assets/:id" element={<Layout><AuctionTerminal /></Layout>} />
        <Route path="/auth" element={<Layout><AuthScreen /></Layout>} />
        <Route path="*" element={<Navigate to="/assets" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);

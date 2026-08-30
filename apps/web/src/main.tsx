import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { AppProvider } from './context';
import { DashboardPage } from './pages/DashboardPage';
import { MarketDataPage } from './pages/MarketDataPage';
import { FinancialsPage } from './pages/FinancialsPage';
import { LoanSimulatorPage } from './pages/LoanSimulatorPage';
import { FundingPage } from './pages/FundingPage';
import { AdvisorPage } from './pages/AdvisorPage';
import { DeveloperPage } from './pages/DeveloperPage';
import './styles/app.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'market', element: <MarketDataPage /> },
      { path: 'financials', element: <FinancialsPage /> },
      { path: 'loans', element: <LoanSimulatorPage /> },
      { path: 'funding', element: <FundingPage /> },
      { path: 'advisor', element: <AdvisorPage /> },
      { path: 'developer', element: <DeveloperPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </StrictMode>,
);

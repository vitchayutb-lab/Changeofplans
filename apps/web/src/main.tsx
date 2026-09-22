import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, redirect, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { AppProvider } from './context';
import { hasSeenWelcome } from './lib/welcome';
import { WelcomePage } from './pages/WelcomePage';
import { DashboardPage } from './pages/DashboardPage';
import { MarketDataPage } from './pages/MarketDataPage';
import { FinancialsPage } from './pages/FinancialsPage';
import { BenchmarksPage } from './pages/BenchmarksPage';
import { LoanSimulatorPage } from './pages/LoanSimulatorPage';
import { DebtCapacityPage } from './pages/DebtCapacityPage';
import { DebtOutlookPage } from './pages/DebtOutlookPage';
import { FundingPage } from './pages/FundingPage';
import { FundingStrategyPage } from './pages/FundingStrategyPage';
import { LendingConditionsPage } from './pages/LendingConditionsPage';
import { StartupPage } from './pages/StartupPage';
import { AdvisorPage } from './pages/AdvisorPage';
import { DeveloperPage } from './pages/DeveloperPage';
import { NotFoundPage } from './pages/NotFoundPage';
import './styles/app.css';

const router = createBrowserRouter([
  {
    path: '/welcome',
    element: <WelcomePage />,
    errorElement: <NotFoundPage />,
  },
  {
    path: '/',
    element: <App />,
    // ไม่มีตัวนี้ react-router จะแสดงหน้าข้อผิดพลาดของตัวเองที่พูดกับนักพัฒนา
    // ซึ่งไม่ควรโผล่บนเว็บที่เปิดให้คนทั่วไปใช้
    errorElement: <NotFoundPage />,
    children: [
      {
        index: true,
        // เปิดเว็บครั้งแรกยังไม่เคยเห็นหน้า Welcome — พาไปหน้านั้นก่อนเข้า Dashboard
        loader: () => (hasSeenWelcome() ? null : redirect('/welcome')),
        element: <DashboardPage />,
      },
      { path: 'market', element: <MarketDataPage /> },
      { path: 'financials', element: <FinancialsPage /> },
      { path: 'benchmarks', element: <BenchmarksPage /> },
      { path: 'loans', element: <LoanSimulatorPage /> },
      { path: 'debt-capacity', element: <DebtCapacityPage /> },
      { path: 'debt-outlook', element: <DebtOutlookPage /> },
      { path: 'startup', element: <StartupPage /> },
      { path: 'funding', element: <FundingPage /> },
      { path: 'funding-strategy', element: <FundingStrategyPage /> },
      { path: 'lending-conditions', element: <LendingConditionsPage /> },
      { path: 'advisor', element: <AdvisorPage /> },
      { path: 'developer', element: <DeveloperPage /> },
      // ที่อยู่ที่ไม่ตรงกับหน้าใด ยังคงเห็นเมนูด้านข้างและกลับไปหน้าอื่นได้
      { path: '*', element: <NotFoundPage /> },
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

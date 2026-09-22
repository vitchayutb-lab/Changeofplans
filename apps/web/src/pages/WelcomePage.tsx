/** หน้าแรกสุด (Welcome / Guidelines) — แสดงก่อนเข้าหน้า Dashboard ในการเปิดเว็บครั้งแรก */

import { Link, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../nav';
import { markWelcomeSeen } from '../lib/welcome';
import { ThemeToggle } from '../components/ThemeToggle';

const STEPS = [
  { n: 1, title: 'เลือก Category', body: 'เลือกหมวดหมู่จากเมนูด้านข้างตามสิ่งที่ต้องการทำ' },
  { n: 2, title: 'เลือกสิ่งที่ต้องการใช้งาน', body: 'เลือกกิจการหรือเงื่อนไขที่ต้องการดูภายในหมวดนั้น' },
  { n: 3, title: 'ดูข้อมูล / วิเคราะห์ / ใช้งาน', body: 'อ่านผลวิเคราะห์ ตัวเลข หรือใช้ฟีเจอร์ที่หมวดนั้นมีให้' },
];

export function WelcomePage() {
  const navigate = useNavigate();

  function handleGetStarted() {
    markWelcomeSeen();
    navigate('/', { replace: true });
  }

  return (
    <div className="welcome">
      <div className="welcome__topbar">
        <ThemeToggle />
      </div>

      <section className="welcome__hero">
        <div className="welcome__mark">฿</div>
        <h1 className="welcome__title">SME Finance Copilot</h1>
        <p className="welcome__subtitle">ทุกสิ่งที่ธุรกิจ SME ต้องใช้ในการวางแผนการเงิน อยู่ในที่เดียว</p>
        <p className="welcome__desc">
          เว็บไซต์นี้ช่วยวิเคราะห์งบการเงิน เทียบเกณฑ์มาตรฐานอุตสาหกรรม จำลองสินเชื่อ และแนะนำแหล่งเงินทุน
          โดยอ้างอิงข้อมูลตลาดจากธนาคารแห่งประเทศไทย เพื่อให้เจ้าของธุรกิจตัดสินใจได้ง่ายขึ้น
        </p>
        <button className="btn btn--primary btn--lg" onClick={handleGetStarted}>
          Get Started →
        </button>
      </section>

      <section className="welcome__steps">
        <h2 className="welcome__section-title">วิธีใช้งาน</h2>
        <div className="welcome__steps-row">
          {STEPS.map((step) => (
            <div className="welcome__step" key={step.n}>
              <div className="welcome__step-num">{step.n}</div>
              <div className="welcome__step-title">{step.title}</div>
              <div className="welcome__step-body">{step.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="welcome__categories">
        <h2 className="welcome__section-title">แต่ละ Category ใช้ทำอะไร?</h2>
        <div className="welcome__category-grid">
          {NAV_ITEMS.map((item) => (
            <Link className="category-card" to={item.to} key={item.to} onClick={markWelcomeSeen}>
              <span className="category-card__icon" aria-hidden>
                {item.icon}
              </span>
              <div className="category-card__title">{item.label}</div>
              <p className="category-card__desc">{item.description}</p>
              <p className="category-card__audience">{item.audience}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="welcome__footer">
        <button className="btn btn--primary btn--lg" onClick={handleGetStarted}>
          Get Started →
        </button>
        <Link className="tiny muted" to="/">
          ข้ามไปหน้าหลัก
        </Link>
      </div>
    </div>
  );
}

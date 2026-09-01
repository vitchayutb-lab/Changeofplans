/**
 * ลิงก์อ้างอิงออกไปยังเว็บภายนอก
 *
 * ทุกลิงก์เปิดแท็บใหม่พร้อม rel="noreferrer noopener" — หน้าปลายทางเป็นของ
 * คนอื่น จึงต้องกันไม่ให้เข้าถึง window.opener ของเรากลับมาได้
 */

import type { ReferenceLink } from '@sme/shared';

export function ReferenceLinks({ links }: { links: ReferenceLink[] }) {
  if (links.length === 0) return null;

  return (
    <ul className="reference">
      {links.map((link) => (
        <li className="reference__item" key={link.url}>
          <a className="reference__link" href={link.url} target="_blank" rel="noreferrer noopener">
            {link.labelTh}
            <span aria-hidden> ↗</span>
            <span className="sr-only"> (เปิดแท็บใหม่)</span>
          </a>
          <span className="reference__note">{link.noteTh}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * ลิงก์เดี่ยวแบบบรรทัดเดียว สำหรับวางท้ายการ์ดโครงการ
 *
 * ป้ายบอกว่าเป็น "เว็บไซต์ผู้ให้บริการ" ไม่ใช่ "หน้าโครงการ" เพราะปลายทาง
 * เป็นหน้าเว็บของหน่วยงาน ผู้ใช้ยังต้องกดหาโครงการต่อเองอีกขั้น
 */
export function ProviderLink({ url, provider }: { url: string | null; provider: string }) {
  if (!url) return null;

  return (
    <a
      className="reference__link reference__link--inline"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      เว็บไซต์ผู้ให้บริการ
      <span aria-hidden> ↗</span>
      <span className="sr-only"> {provider} (เปิดแท็บใหม่)</span>
    </a>
  );
}

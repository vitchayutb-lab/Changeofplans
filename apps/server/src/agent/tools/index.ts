/** รวมเครื่องมือทั้งหมดเข้าเป็นทะเบียนเดียว */

import { ToolRegistry } from '../registry.js';
import { botTools } from './botTools.js';
import { financeTools } from './financeTools.js';
import { fundingTools } from './fundingTools.js';
import { startupTools } from './startupTools.js';

let registry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registry) {
    registry = new ToolRegistry().register(
      ...botTools,
      ...financeTools,
      ...fundingTools,
      ...startupTools,
    );
  }
  return registry;
}

export { botTools, financeTools, fundingTools, startupTools };

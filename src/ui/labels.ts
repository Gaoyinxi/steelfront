import type { ArmorFace, ArmorPart } from '../combat/armorModel';
import type { DestroyCause } from '../components/Modules';
import type { CrewRole, ModuleType } from '../data/schema';

/** Display strings (zh-CN). Kept in one place for later localization. */
export const MODULE_LABEL: Record<ModuleType, string> = {
  engine: '发动机',
  transmission: '传动装置',
  turretRing: '炮塔座圈',
  ammoRack: '弹药架',
  fuelTank: '油箱',
  gunBreech: '炮闩',
  crew: '乘员',
};

export const CREW_LABEL: Record<CrewRole, string> = {
  commander: '车长',
  gunner: '炮手',
  loader: '装填手',
  driver: '驾驶员',
  radio: '机电员',
};

export const CREW_SHORT: Record<CrewRole, string> = {
  commander: '长',
  gunner: '炮',
  loader: '装',
  driver: '驾',
  radio: '机',
};

export const PART_LABEL: Record<ArmorPart, string> = { hull: '车体', turret: '炮塔' };
export const FACE_LABEL: Record<ArmorFace, string> = { front: '正面', side: '侧面', rear: '后部', top: '顶部', bottom: '底部' };
export const CAUSE_LABEL: Record<DestroyCause, string> = { ammoDetonation: '弹药殉爆', crewLoss: '乘员失去战斗力' };

export function moduleLabel(type: ModuleType, role?: CrewRole): string {
  return type === 'crew' && role ? CREW_LABEL[role] : MODULE_LABEL[type];
}

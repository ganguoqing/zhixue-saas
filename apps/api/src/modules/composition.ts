import { evaluateGrade, insertGradeProposal } from './grading-port';
import { projectAssetNotice } from './relay-port';
import { claimObjectReclaim } from './storage-port';

export interface ModulePorts {
  evaluateGrade: typeof evaluateGrade;
  insertGradeProposal: typeof insertGradeProposal;
  claimObjectReclaim: typeof claimObjectReclaim;
  projectAssetNotice: typeof projectAssetNotice;
}

export function composePorts(): ModulePorts {
  return { evaluateGrade, insertGradeProposal, claimObjectReclaim, projectAssetNotice };
}

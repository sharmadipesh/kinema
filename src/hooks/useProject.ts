import { useCallback, useEffect, useState } from 'react';
import { emptyProject, type Confirmable, type ProjectBrief, type ProjectRecord, type RecreationMode, type StageEdit, type StageStructureEdit } from '../types/project.ts';
import { readProject, resetStageField, writeProject, writeStageEdit } from '../storage/project.ts';

/**
 * The user's layer over one analysis, kept in sync with storage.
 *
 * Optimistic on every write: the panel updates from local state immediately and
 * reconciles with what storage returns. Waiting on a disk round-trip to tick a
 * checkbox makes the panel feel broken, and the write cannot meaningfully fail
 * in a way the user could act on — `writeProject` already swallows quota errors
 * rather than losing the analysis over a confirmation.
 */
export function useProject(analysisId: string | null): {
  project: ProjectRecord;
  setMode(mode: RecreationMode): void;
  patchBrief(patch: Partial<ProjectBrief>): void;
  confirm(key: Confirmable, value: boolean): void;
  editStage(stageId: string, patch: Partial<StageEdit>): void;
  resetStage(stageId: string, field: keyof StageEdit): void;
  setFootage(item: string, state: ProjectRecord['footage'][string]): void;
  pushStructure(edit: StageStructureEdit): void;
  loaded: boolean;
} {
  const [project, setProject] = useState<ProjectRecord>(() => emptyProject(analysisId ?? 'none'));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!analysisId) {
      setProject(emptyProject('none'));
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    setLoaded(false);
    void readProject(analysisId).then((record) => {
      if (cancelled) return;
      setProject(record);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const commit = useCallback(
    (patch: Partial<Omit<ProjectRecord, 'analysisId'>>) => {
      if (!analysisId) return;
      setProject((current) => ({ ...current, ...patch }));
      void writeProject(analysisId, patch).then(setProject);
    },
    [analysisId],
  );

  const setMode = useCallback((mode: RecreationMode) => commit({ mode }), [commit]);

  const patchBrief = useCallback(
    (patch: Partial<ProjectBrief>) => {
      setProject((current) => {
        const brief = { ...current.brief, ...patch };
        if (analysisId) void writeProject(analysisId, { brief }).then(setProject);
        return { ...current, brief };
      });
    },
    [analysisId],
  );

  const confirm = useCallback(
    (key: Confirmable, value: boolean) => {
      setProject((current) => {
        const confirmations = { ...current.confirmations, [key]: value };
        if (analysisId) void writeProject(analysisId, { confirmations }).then(setProject);
        return { ...current, confirmations };
      });
    },
    [analysisId],
  );

  const editStage = useCallback(
    (stageId: string, patch: Partial<StageEdit>) => {
      if (!analysisId) return;
      setProject((current) => ({
        ...current,
        stageEdits: { ...current.stageEdits, [stageId]: { ...current.stageEdits[stageId], ...patch } },
      }));
      void writeStageEdit(analysisId, stageId, patch).then(setProject);
    },
    [analysisId],
  );

  const resetStage = useCallback(
    (stageId: string, field: keyof StageEdit) => {
      if (!analysisId) return;
      void resetStageField(analysisId, stageId, field).then(setProject);
    },
    [analysisId],
  );

  const setFootage = useCallback(
    (item: string, state: ProjectRecord['footage'][string]) => {
      setProject((current) => {
        const footage = { ...current.footage, [item]: state };
        if (analysisId) void writeProject(analysisId, { footage }).then(setProject);
        return { ...current, footage };
      });
    },
    [analysisId],
  );

  const pushStructure = useCallback(
    (edit: StageStructureEdit) => {
      setProject((current) => {
        const structure = [...current.structure, edit];
        if (analysisId) void writeProject(analysisId, { structure }).then(setProject);
        return { ...current, structure };
      });
    },
    [analysisId],
  );

  return { project, setMode, patchBrief, confirm, editStage, resetStage, setFootage, pushStructure, loaded };
}

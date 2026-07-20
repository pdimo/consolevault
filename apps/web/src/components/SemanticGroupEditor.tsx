/**
 * Per-property editor for one kind of semantic group — content groups (page-URL rules) or topic
 * clusters (query rules). Deterministic + fully inspectable: a group is a name + a list of OR'd
 * match rules. (AI-suggest arrives in Phase 2b and will just pre-fill these same rules.)
 */

import { useEffect, useState } from 'react';
import type { MatchRule, SemanticGroup } from '@consolevault/types';
import { api } from '../api';
import { Badge, Button, Select, TextInput } from './ui';
import { useToast } from './feedback';

const OPS: { v: MatchRule['op']; label: string }[] = [
  { v: 'contains', label: 'contains' },
  { v: 'starts_with', label: 'starts with' },
  { v: 'equals', label: 'equals' },
  { v: 'regex', label: 'regex' },
];

interface DraftRule {
  op: MatchRule['op'];
  value: string;
}
interface Draft {
  name: string;
  priority: boolean;
  rules: DraftRule[];
}
const emptyDraft = (): Draft => ({
  name: '',
  priority: false,
  rules: [{ op: 'contains', value: '' }],
});

export function SemanticGroupEditor({
  propertyId,
  kind,
}: {
  propertyId: string;
  kind: 'content' | 'topic';
}) {
  const toast = useToast();
  const [groups, setGroups] = useState<SemanticGroup[] | null>(null);
  const [editId, setEditId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const target = kind === 'content' ? 'page URL' : 'query';

  const reload = () =>
    api
      .listSemanticGroups(propertyId, kind)
      .then(setGroups)
      .catch(() => setGroups([]));
  useEffect(() => {
    reload();
  }, [propertyId, kind]);

  const startEdit = (g: SemanticGroup) => {
    setEditId(g.id);
    setDraft({
      name: g.name,
      priority: !!g.priority,
      rules: g.rules.length
        ? g.rules.map((r) => ({ op: r.op, value: r.value }))
        : [{ op: 'contains', value: '' }],
    });
  };

  const save = async () => {
    if (!draft.name.trim()) return toast('Name is required', 'error');
    const payload = {
      kind,
      name: draft.name.trim(),
      priority: draft.priority,
      rules: draft.rules
        .filter((r) => r.value.trim())
        .map((r) => ({
          dimension: (kind === 'content' ? 'page' : 'query') as MatchRule['dimension'],
          op: r.op,
          value: r.value.trim(),
        })),
    };
    try {
      if (editId === 'new') await api.createSemanticGroup(propertyId, payload);
      else if (editId) await api.updateSemanticGroup(propertyId, editId, payload);
      setEditId(null);
      await reload();
      toast('Saved', 'success');
    } catch {
      toast('Save failed', 'error');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteSemanticGroup(propertyId, id);
      await reload();
    } catch {
      toast('Delete failed', 'error');
    }
  };

  const [generating, setGenerating] = useState(false);
  const generate = async () => {
    setGenerating(true);
    try {
      const suggestions = await api.autoSuggestGroups(propertyId, kind);
      const existing = new Set((groups ?? []).map((g) => g.name.toLowerCase()));
      const fresh = suggestions.filter((s) => !existing.has(s.name.toLowerCase()));
      if (!fresh.length) return toast('No new groups to add', 'info');
      await Promise.all(
        fresh.map((s) =>
          api.createSemanticGroup(propertyId, { kind, name: s.name, rules: s.rules }),
        ),
      );
      await reload();
      toast(
        `Added ${fresh.length} ${kind === 'content' ? 'content groups' : 'topic clusters'}`,
        'success',
      );
    } catch {
      toast('Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const setRule = (i: number, patch: Partial<DraftRule>) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  return (
    <div className="flex flex-col gap-3">
      {groups == null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : groups.length === 0 && editId == null ? (
        <p className="text-sm text-muted">
          No {kind === 'content' ? 'content groups' : 'topic clusters'} yet.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {g.priority && <span className="mr-1 text-warn">★</span>}
                {g.name}
              </span>
              <Badge tone="neutral">{g.rules.length} rules</Badge>
              <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(g.id)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      {editId != null ? (
        <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-surface-2/30 p-3">
          <div className="flex items-center gap-3">
            <TextInput
              placeholder="Group name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.checked }))}
              />
              Priority ★
            </label>
          </div>
          <p className="text-xs text-muted">Rows match when ANY rule matches the {target}.</p>
          {draft.rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs text-muted">{target}</span>
              <Select
                value={r.op}
                onChange={(e) => setRule(i, { op: e.target.value as MatchRule['op'] })}
              >
                {OPS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <TextInput
                placeholder="value"
                value={r.value}
                onChange={(e) => setRule(i, { value: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))
                }
              >
                ✕
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDraft((d) => ({ ...d, rules: [...d.rules, { op: 'contains', value: '' }] }))
              }
            >
              + Rule
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setEditId('new');
              setDraft(emptyDraft());
            }}
          >
            + Add {kind === 'content' ? 'content group' : 'topic cluster'}
          </Button>
          <Button size="sm" variant="secondary" loading={generating} onClick={generate}>
            Generate automatically
          </Button>
        </div>
      )}
    </div>
  );
}

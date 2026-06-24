'use client';

import type { SectionType } from '@template/lp-render';
import { useState, type ReactNode } from 'react';

import { centsToMajor, coerceInput, deriveLeafFields, type LeafField } from './edit-fields';

/**
 * SectionEditor — per-section form for the landing-page editor (SPEC-012).
 *
 * Renders one input per leaf field (derived from the section schema) and PATCHes
 * a single field at a time to `/api/landing-pages/:id/sections/:type`. The edit
 * is SYNCHRONOUS: on `200` the new `version` is captured for the next optimistic
 * write; on `409` we surface a conflict so the operator reloads. Money fields are
 * shown in major units and sent as integer cents (server enforces the contract).
 */

export interface SectionEditorProps {
  landingPageId: string;
  type: SectionType;
  fields: Record<string, unknown>;
  version: number;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

export function SectionEditor(props: SectionEditorProps): ReactNode {
  const [version, setVersion] = useState(props.version);
  const [fields, setFields] = useState(props.fields);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const leaves = deriveLeafFields(props.type, fields);

  async function saveField(leaf: LeafField, raw: string): Promise<void> {
    setState({ kind: 'saving' });
    const value = coerceInput(leaf.kind, leaf.isCents, raw);
    try {
      const res = await fetch(`/api/landing-pages/${props.landingPageId}/sections/${props.type}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: leaf.path, value, expectedVersion: version }),
      });
      if (res.status === 200) {
        const data = (await res.json()) as {
          section: { fields: Record<string, unknown>; version: number };
        };
        setFields(data.section.fields);
        setVersion(data.section.version);
        setState({ kind: 'saved' });
        return;
      }
      if (res.status === 409) {
        setState({ kind: 'conflict' });
        return;
      }
      if (res.status === 422) {
        setState({ kind: 'invalid', message: 'Valor inválido para este campo.' });
        return;
      }
      setState({ kind: 'error', message: `Falha ao salvar (HTTP ${res.status}).` });
    } catch {
      setState({ kind: 'error', message: 'Erro de rede ao salvar.' });
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          {props.type}
        </h3>
        <span className="text-xs text-zinc-400">v{version}</span>
      </header>

      <div className="flex flex-col gap-3">
        {leaves.map((leaf) => (
          <FieldRow
            key={leaf.path}
            leaf={leaf}
            disabled={state.kind === 'saving'}
            onSave={saveField}
          />
        ))}
      </div>

      <SaveStatus state={state} />
    </section>
  );
}

function FieldRow({
  leaf,
  disabled,
  onSave,
}: {
  leaf: LeafField;
  disabled: boolean;
  onSave: (leaf: LeafField, raw: string) => Promise<void>;
}): ReactNode {
  const initial =
    leaf.kind === 'number' && leaf.isCents && typeof leaf.value === 'number'
      ? centsToMajor(leaf.value)
      : String(leaf.value ?? '');
  const [draft, setDraft] = useState(initial);

  if (leaf.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          defaultChecked={leaf.value === true}
          disabled={disabled}
          onChange={(e) => void onSave(leaf, e.target.checked ? 'true' : 'false')}
        />
        {leaf.label}
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">
        {leaf.label}
        {leaf.isCents ? ' (R$)' : ''}
      </span>
      <input
        className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        type={leaf.kind === 'number' ? 'number' : 'text'}
        step={leaf.isCents ? '0.01' : undefined}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== initial) {
            void onSave(leaf, draft);
          }
        }}
      />
    </label>
  );
}

function SaveStatus({ state }: { state: SaveState }): ReactNode {
  if (state.kind === 'idle') {
    return null;
  }
  const text =
    state.kind === 'saving'
      ? 'Salvando…'
      : state.kind === 'saved'
        ? 'Salvo.'
        : state.kind === 'conflict'
          ? 'Conflito de versão — recarregue a seção.'
          : state.kind === 'invalid'
            ? state.message
            : state.message;
  const tone =
    state.kind === 'saved'
      ? 'text-green-600'
      : state.kind === 'saving'
        ? 'text-zinc-500'
        : 'text-red-600';
  return <p className={`mt-3 text-xs ${tone}`}>{text}</p>;
}

import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Strong, Em, Lozenge, Link, Stack, Inline, Spinner } from '@forge/react';
import { invoke, view } from '@forge/bridge';

/**
 * Confluence macro: the projected incidents of this space, on any page.
 * Reads the published post-mortems (the record on the Confluence side).
 */
const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const ctx = await view.getContext();
        const spaceKey = ctx?.extension?.space?.key ?? ctx?.extension?.content?.space?.key ?? null;
        setData(await invoke('getMacroSummary', { spaceKey }));
      } catch (err) { setData({ ok: false, error: String(err?.message ?? err) }); }
    })();
  }, []);

  if (!data) return <Spinner size="small" />;
  if (!data.ok) return <Text><Em>Antemortem: {data.error}</Em></Text>;
  const { projected, averted } = data;

  if (!projected.length) {
    return <Text><Strong>Antemortem</Strong> — no projected incident in this space.{averted.length ? ` ${averted.length} averted.` : ''}</Text>;
  }
  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Strong>Antemortem</Strong>
        <Lozenge appearance="removed">{projected.length} projected incident{projected.length === 1 ? '' : 's'}</Lozenge>
        {averted.length ? <Lozenge appearance="success">{averted.length} averted</Lozenge> : null}
      </Inline>
      {projected.map((fi) => (
        <Inline key={fi.id} space="space.100" alignBlock="center">
          <Lozenge appearance="removed">{Math.round(fi.probability * 100)} %</Lozenge>
          <Text>{fi.url ? <Link href={fi.url} openNewTab>{fi.title}</Link> : fi.title}{fi.costText ? ` · ${fi.costText}` : ''}</Text>
        </Inline>
      ))}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);

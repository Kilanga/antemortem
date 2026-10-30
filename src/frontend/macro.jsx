import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Strong, Em, Lozenge, Link, Stack, Inline, Spinner } from '@forge/react';
import { invoke } from '@forge/bridge';

/**
 * Confluence macro: the projected incidents, on any page — a contract page,
 * a steering-committee page, a team home. Read-only, one block.
 */
const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => { invoke('getMacroSummary').then(setData).catch((err) => setData({ ok: false, error: String(err?.message ?? err) })); }, []);

  if (!data) return <Spinner size="small" />;
  if (!data.ok) return <Text><Em>Antemortem: {data.error}</Em></Text>;
  const { incidents, atRisk, totalCost, currency, commandCenterUrl } = data;

  if (!incidents.length && !atRisk.length) {
    return <Text><Strong>Antemortem</Strong> — every obligation holds.{commandCenterUrl ? <> <Link href={commandCenterUrl} openNewTab>Command center</Link></> : null}</Text>;
  }

  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Strong>Antemortem</Strong>
        <Lozenge appearance="removed">{incidents.length} projected incident{incidents.length === 1 ? '' : 's'}</Lozenge>
        <Text>{fmtMoney(totalCost, currency)} in projected penalties</Text>
      </Inline>
      {incidents.map((fi) => (
        <Inline key={fi.id} space="space.100" alignBlock="center">
          <Lozenge appearance="removed">{Math.round(fi.probability * 100)} %</Lozenge>
          <Text>{fi.url ? <Link href={fi.url} openNewTab>{fi.title}</Link> : fi.title} · {fi.incidentDate} · {fmtMoney(fi.cost, fi.currency)}</Text>
        </Inline>
      ))}
      {atRisk.filter((o) => !incidents.some((fi) => fi.obligationId === o.id)).map((o) => (
        <Inline key={o.id} space="space.100" alignBlock="center">
          <Lozenge appearance="moved">{Math.round(o.probability * 100)} %</Lozenge>
          <Text><Strong>{o.code}</Strong> {o.title} · below the publish threshold</Text>
        </Inline>
      ))}
      {commandCenterUrl ? <Text><Link href={commandCenterUrl} openNewTab>Open the command center</Link></Text> : null}
    </Stack>
  );
};

const fmtMoney = (n, c = 'EUR') => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n ?? 0)); } catch { return `${n} ${c}`; } };

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);

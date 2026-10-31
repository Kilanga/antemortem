import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Strong, Em, Lozenge, Link, Stack, Inline, Spinner } from '@forge/react';
import { invoke } from '@forge/bridge';

/** Dashboard gadget: the next post-mortem, and what holds. */
const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => { invoke('getGadgetSummary').then(setData).catch((err) => setData({ ok: false, error: String(err?.message ?? err) })); }, []);

  if (!data) return <Spinner size="small" />;
  if (!data.ok) return <Text><Em>Antemortem: {data.error}</Em></Text>;
  const { next, atRisk, holding, exposure, currency, analysedAt } = data;

  return (
    <Stack space="space.100">
      {next ? (
        <>
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance="removed" isBold>{next.daysTo} days</Lozenge>
            <Text><Strong>{next.title}</Strong></Text>
          </Inline>
          <Text>{Math.round(next.probability * 100)} % · {fmtMoney(next.cost, next.currency)} · {next.url ? <Link href={next.url} openNewTab>post-mortem</Link> : 'post-mortem pending'}</Text>
        </>
      ) : (
        <Text><Strong>No post-mortem due.</Strong></Text>
      )}
      {atRisk.map((o) => (
        <Text key={o.code}><Lozenge appearance={o.probability >= 0.6 ? 'removed' : 'moved'}>{Math.round(o.probability * 100)} %</Lozenge> {o.code} {o.title}</Text>
      ))}
      <Text><Em>{holding} obligation{holding === 1 ? '' : 's'} hold · {fmtMoney(exposure, currency)} exposed{analysedAt ? ` · analysed ${analysedAt}` : ''}</Em></Text>
    </Stack>
  );
};

const fmtMoney = (n, c = 'EUR') => { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n ?? 0)); } catch { return `${n} ${c}`; } };

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);

import { FormEvent, useState } from 'react';
import { useMutations } from '../lib/api';
import { Modal, useToast } from './ui';

/** "Mark as invested" — records a manual position the agent will then monitor. */
export function PositionModal(props: { ticker?: string; price?: number | null; onClose: () => void }) {
  const { createPosition } = useMutations();
  const toast = useToast();
  const [ticker, setTicker] = useState(props.ticker ?? '');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState(props.price ? String(props.price) : '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await createPosition.mutateAsync({
        ticker: ticker.trim().toUpperCase(),
        quantity: Number(qty),
        entryPrice: Number(price),
        entryDate: date,
        notes: notes || undefined,
      });
      toast(`${ticker.toUpperCase()} added — the agent will review it shortly`);
      props.onClose();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <Modal title="Mark as invested" onClose={props.onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">
          Ticker
          <input className="input mono" required value={ticker} onChange={(e) => setTicker(e.target.value)} disabled={!!props.ticker} maxLength={10} />
        </label>
        <div className="grid-2">
          <label className="field">
            Shares
            <input className="input mono" required type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="field">
            Entry price ($)
            <input className="input mono" required type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <label className="field">
          Entry date
          <input className="input mono" required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Notes (optional — your thesis, targets)
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {err && <div className="error">{err}</div>}
        <div className="row-flex" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={createPosition.isPending}>
            {createPosition.isPending ? 'Saving…' : 'Save position'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

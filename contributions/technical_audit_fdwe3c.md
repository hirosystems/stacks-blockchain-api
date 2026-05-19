**NAMA_FITUR:** Event Replay untuk Upgrade Major Version  
**PENJELASAN TEKNIS:**  
Fitur ini memungkinkan pemulihan konsistensi data PostgreSQL setelah upgrade major versi API (misal 3.x → 4.x) tanpa perlu wipe database dan resync penuh dari blockchain. Proses replay membaca event-chain dari checkpoint tertentu (disimpan di tabel `chain_state`) lalu menerapkan ulang transaksi/event yang belum diproses oleh versi API baru. Mekanisme ini mengandalkan:  
1. **Checkpointing** – Penyimpanan hash blok terproses di `chain_state`.  
2. **Idempotent Event Processing** – Setiap event memiliki `event_id` unik untuk mencegah duplikasi.  
3. **Cursor-based Replay** – Mulai dari `last_processed_block_height` yang tersimpan.  
Fitur ini kritis untuk menghindari downtime panjang dan kehilangan data selama upgrade produksi.  

**CONTOH KODE/DOKUMENTASI (Unit Test Scenario yang Belum Ada):**  
```typescript
// tests/integration/event-replay.spec.ts
import { EventProcessor, Database } from '@hirosystems/stacks-blockchain-api';
import { StacksMockNode } from '../mocks/stacks-node';

describe('Event Replay after Major Version Upgrade', () => {
  let db: Database;
  let processor: EventProcessor;
  let mockNode: StacksMockNode;

  beforeEach(async () => {
    db = new Database({ connectionString: 'postgres://...' });
    await db.migrate(); // Reset schema untuk test
    mockNode = new StacksMockNode();
    processor = new EventProcessor({ db, node: mockNode });
  });

  it('should replay missing events from checkpoint without duplication', async () => {
    // 1. Simulasi: API v3 memproses blok 1-100, lalu crash di blok 101
    await processor.processBlocks(1, 100);
    await processor.simulateCrashAtBlock(101); // Simpan checkpoint di blok 100

    // 2. Upgrade ke API v4 (skenario: schema DB berubah, event_id format baru)
    await db.upgradeSchema('v4'); // Migrasi schema

    // 3. Jalankan replay dari checkpoint (blok 101)
    const replayedEvents = await processor.replayFromCheckpoint();

    // 4. Verifikasi:
    // - Tidak ada duplikasi event (count event_id unik == total event)
    const uniqueEvents = new Set(replayedEvents.map(e => e.event_id));
    expect(uniqueEvents.size).toBe(replayedEvents.length);

    // - Konsistensi state (contoh: saldo akun setelah replay)
    const balance = await db.getBalance('ST1PQHQKV0RJ3F0SJ6J0Q8Z8ZJZQK3YQK3YQK3YQ');
    expect(balance).toBe(1000); // Nilai yang diharapkan setelah blok 101-150

    // - Checkpoint terbarot diupdate ke blok 150
    const checkpoint = await db.getChainState();
    expect(checkpoint.last_processed_block).toBe(150);
  });

  it('should handle fork resolution during replay', async () => {
    // Simulasi fork di blok 200 (node v3 memproses branch A, v4 branch B)
    await processor.processBlocks(1, 199, { fork: 'A' });
    await processor.simulateCrashAtBlock(200);

    // Upgrade & replay dengan fork baru
    await db.upgradeSchema('v4');
    await processor.replayFromCheckpoint({ targetFork: 'B' });

    // Verifikasi: state sesuai branch B
    const tx = await db.getTransaction('txid_fork_B');
    expect(tx.fork_id).toBe('B');
  });
});
```

**DOKUMENTASI PENDUKUNG:**  
```markdown
## Event Replay Instructions (Tambahan untuk Test)
1. **Pre-requisite**: Pastikan `chain_state` tabel memiliki checkpoint valid.
2. **Command**: 
   ```bash
   STACKS_API_MODE=replay npm start -- --from-checkpoint
   ```
3. **Monitoring**:  
   - Log `[REPLAY]` menampilkan blok yang di-replay.  
   - Metric `replay_events_total` di Prometheus.  
4. **Rollback**: Jika replay gagal, gunakan `--rollback-to <block-height>` untuk kembali ke checkpoint sebelumnya.
```

**Alasan Pilihan Skenario:**  
- Test ini menguji **failure scenario kritis** (crash selama upgrade) yang tidak di-cover oleh test existing.  
- Memvalidasi **idempotency** dan **fork handling** – dua tantangan utama dalam replay.  
- Menggambarkan alur produksi nyata: upgrade → replay → verifikasi state.  
- README hanya menyebut "follow event replay instructions" tanpa detail mekanisme atau validasi, sehingga test ini mengisi celah dokumentasi teknis.
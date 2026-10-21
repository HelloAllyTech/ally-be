import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One thing a Builder session looked up, and what came back.
 *
 * The interview's lookups used to exist only as tool results inside the
 * transcript, which is replayed to the model and then, past forty messages,
 * summarised from the prose alone — so by the end of a long interview nothing
 * recorded which files had actually been read. In session 2bc3a5cf the PRD
 * described a module whose files had both returned 404, and nothing could tell
 * a reviewer that.
 *
 * This is that record. Every research lookup writes a row whether it succeeded
 * or not, so the PRD's claims can be checked against what was read (the
 * readiness rubric and the reviewer do), and the technical design starts from
 * what the interview already found instead of searching again.
 *
 * Append-only and small: an excerpt, never a whole file.
 */
@Entity('builder_evidence')
@Index('idx_builder_evidence_session', ['sessionId', 'createdAt'])
export class BuilderEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /** The tool that produced it: github_read_file, docs_search, capability_lookup… */
  @Column({ type: 'varchar', length: 60 })
  tool!: string;

  /** What was looked up: `repo:path` for a read, the query for a search. */
  @Column({ type: 'varchar', length: 500 })
  source!: string;

  @Column({ type: 'boolean' })
  ok!: boolean;

  /** The first few hundred characters of what came back, or the error. */
  @Column({ type: 'text', nullable: true })
  excerpt?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

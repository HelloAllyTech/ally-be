import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tooltip_translations')
@Index(
  'uq_tooltip_translations_tooltip_id_lang_id_idx',
  ['tooltipId', 'languageId'],
  {
    unique: true,
  },
)
export class TooltipTranslations {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tooltipId!: string;

  @Column()
  languageId!: number;

  @Column('text')
  tipText!: string;
}

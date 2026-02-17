import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionMessageTags } from '../entity/scenario-session-message-tags.entity';
import { ScenarioSessionTags } from '../entity/scenario-session-tags.entity';
import { Injectable } from '@nestjs/common';
import { ScenarioSessionTagCategory } from '../enum/scenario-session-tag-category.enum';
import { MessageTagMapping } from '../type/scenario-message-tag.type';

@Injectable()
export class ScenarioSessionMessageTagsRepository extends Repository<ScenarioSessionMessageTags> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionMessageTags, dataSource.createEntityManager());
  }

  async getTagsByMessageIds(
    scenarioSessionId: string,
    messageIds: number[],
  ): Promise<Map<number, MessageTagMapping[]>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const rows = await this.createQueryBuilder('msgTag')
      .innerJoin(ScenarioSessionTags, 'tag', 'tag.id = msgTag.tagId')
      .select('msgTag.messageId', 'messageId')
      .addSelect('msgTag.tagId', 'tagId')
      .addSelect('tag.label', 'label')
      .addSelect('msgTag.category', 'category')
      .where('msgTag.scenarioSessionId = :scenarioSessionId', {
        scenarioSessionId,
      })
      .andWhere('msgTag.messageId IN (:...messageIds)', { messageIds })
      .orderBy('msgTag.tagId')
      .getRawMany<{
        messageId: number;
        tagId: string;
        label: string;
        category: ScenarioSessionTagCategory;
      }>();

    const result = new Map<number, MessageTagMapping[]>();
    for (const row of rows) {
      const mapping: MessageTagMapping = {
        tagId: row.tagId,
        label: row.label,
        category: row.category,
      };
      const existing = result.get(row.messageId);
      if (existing) {
        existing.push(mapping);
      } else {
        result.set(row.messageId, [mapping]);
      }
    }
    return result;
  }
}

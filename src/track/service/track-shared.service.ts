import { Injectable, NotFoundException } from '@nestjs/common';
import { Track } from '../entity/track.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import { TrackRepository } from '../repository/track.repository';
import { TrackItemRepository } from '../repository/track-item.repository';
import { TrackSectionRepository } from '../repository/track-section.repository';

export interface TrackWithStructure extends Track {
  sections: (TrackSection & { items: TrackItem[] })[];
}

@Injectable()
export class TrackSharedService {
  constructor(
    private readonly trackRepository: TrackRepository,
    private readonly trackSectionRepository: TrackSectionRepository,
    private readonly trackItemRepository: TrackItemRepository,
  ) {}

  async getTrackWithStructure(trackId: string): Promise<TrackWithStructure> {
    const track = await this.trackRepository.findOne({
      where: { id: trackId },
    });
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    const [sections, items] = await Promise.all([
      this.trackSectionRepository.findByTrackId(trackId),
      this.trackItemRepository.findByTrackId(trackId),
    ]);

    const itemsBySection = new Map<string, TrackItem[]>();
    for (const item of items) {
      const list = itemsBySection.get(item.trackSectionId) ?? [];
      list.push(item);
      itemsBySection.set(item.trackSectionId, list);
    }

    return {
      ...track,
      sections: sections.map((section) => ({
        ...section,
        items: (itemsBySection.get(section.id) ?? []).sort(
          (a, b) => a.order - b.order,
        ),
      })),
    };
  }

  async getTrackById(trackId: string): Promise<Track | null> {
    return this.trackRepository.findOne({ where: { id: trackId } });
  }
}

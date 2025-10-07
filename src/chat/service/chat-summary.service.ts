import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { Chat } from '../../common/entities/chat.entity';
import { User } from '../../common/entities/user.entity';
import { FlattenedSummaryNotePayloadCamelCase } from '../../common/entities/type/call.details.type';
import { TokenUser } from '../../auth/type/auth.types';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ChatUtil } from '../util/chat.util';
import {
  DEMOGRAPHIC_FIELDS,
  LANGUAGE_MAP,
  METRIC_FIELDS,
  OTHER_FIELDS,
  SESSION_FIELDS,
} from '../constants/chat.constants';
import { ChatService } from './chat.service';
import { SettingsService } from '../../settings/service/settings.service';
import { UserService } from '../../user/user.service';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from '../../auth/service/permission-validator.service';

@Injectable()
export class ChatSummaryService {
  private readonly logger = LoggerService.getInstance(ChatSummaryService.name);
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly chatService: ChatService,
    private readonly settingsService: SettingsService,
    private readonly userService: UserService,
    private readonly permissionValidator: PermissionValidator,
  ) {}

  async exportSummary(
    tokenUser: TokenUser,
    chatId: number,
  ): Promise<{ summary: string; fileName: string }> {
    const { chat, callDetails } =
      await this.chatService.getChatWithCallDetails(chatId);
    if (!chat) throw new NotFoundException(`Chat with ID ${chatId} not found`);

    // Check if user can access other users' chats (admin/super admin) or is the counselor for this chat
    const canAccessOtherChats =
      await this.permissionValidator.validatePermissions(tokenUser.id, [
        PERMISSIONS.ACCESS_OTHERS_CHATS,
      ]);

    const isAuthorized =
      canAccessOtherChats || tokenUser.id === chat.counselorId;

    if (!isAuthorized) {
      throw new ForbiddenException(
        'You are not authorized to export this chat summary',
      );
    }

    const visibleFields = await this.settingsService.getSummaryFieldsConfig();
    const counselor = chat?.counselorId
      ? await this.userService.get(chat.counselorId)
      : undefined;

    const summaryInfo =
      callDetails?.summary || ({} as FlattenedSummaryNotePayloadCamelCase);
    const summaryName =
      callDetails?.callInfo?.summaryName || ChatUtil.getSummaryName(chat);

    const displayNameMap = this.buildDisplayNameMap();
    const valueMap = this.buildFieldValueMap(
      chat,
      callDetails,
      summaryInfo,
      counselor!,
    );

    let summary = `Chat Summary\n============\n\nSummary Name: ${summaryName}\n\n`;

    const top = OTHER_FIELDS.filter((f) => visibleFields.includes(f as any))
      .map((f) => this.renderField(f, displayNameMap, valueMap))
      .join('\n');
    if (top) summary += `${top}\n\n`;

    summary += this.renderSection(
      'Demographic Details',
      DEMOGRAPHIC_FIELDS,
      visibleFields,
      displayNameMap,
      valueMap,
    );
    summary += this.renderSection(
      'Session Documentation',
      SESSION_FIELDS,
      visibleFields,
      displayNameMap,
      valueMap,
    );
    summary += this.renderSection(
      'Metrics',
      METRIC_FIELDS,
      visibleFields,
      displayNameMap,
      valueMap,
    );

    this.auditLogger.log({
      eventType: AUDIT_EVENTS.EXPORT_SUMMARY,
      details: {
        chatId: chatId.toString(),
      },
    });

    return { summary, fileName: summaryName };
  }

  private buildDisplayNameMap(): Record<string, string> {
    return {
      callId: 'Call ID',
      callDuration: 'Call Duration (seconds)',
      callDate: 'Call Date',
      callTime: 'Call Time',
      clientId: 'Client ID',
      counsellor: 'Counselor',
      callType: 'Call Type',
      age: 'Age',
      gender: 'Gender',
      profession: 'Profession',
      relationshipStatus: 'Relationship Status',
      languages: 'Languages',
      location: 'Location',
      codeOfConcern: 'Code of Concern',
      sessionSummary: 'Session Summary',
      counselingProcessFlow: 'Counseling Process Flow',
      keyConcerns: 'Key Concerns',
      subjectiveObservations: 'Subjective Observations',
      objectiveObservations: 'Objective Observations',
      assessment: 'Assessment',
      dominantFeelings: 'Dominant Feelings',
      issuesWorkedOn: 'Issues Worked On',
      keyTherapeuticTechniques: 'Key Therapeutic Techniques',
      referralsProvided: 'Referrals Provided',
      homework: 'Homework',
      planForNextCall: 'Plan for Next Call',
      tags: 'Tags',
      listeningShare: 'Listening Share',
      reflectiveQuestionsAsked: 'Reflective Questions Asked',
      openEndedQuestionsAsked: 'Open-ended Questions Asked',
      emotionalLift: 'Emotional Lift',
      callQuality: 'Call Quality',
      newCallFollowUp: 'New Call Follow-up',
    };
  }

  private formatLanguages(
    summaryInfo: FlattenedSummaryNotePayloadCamelCase,
  ): string {
    return summaryInfo?.languages?.length
      ? summaryInfo.languages
          .map(({ language, percentage }) => {
            const label =
              LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP] || language;
            return `${label} (${percentage.toFixed(1)}%)`;
          })
          .join(', ')
      : 'N/A';
  }

  private formatTags(
    summaryInfo: FlattenedSummaryNotePayloadCamelCase,
  ): string {
    return summaryInfo?.tags?.length
      ? summaryInfo.tags
          .map((tag) => `${tag.tag} (Positivity: ${tag.positivity_rating})`)
          .join(', ')
      : 'N/A';
  }

  private buildFieldValueMap(
    chat: Chat,
    callDetails: any | undefined,
    summaryInfo: FlattenedSummaryNotePayloadCamelCase,
    counselor: User | undefined,
  ): Record<string, string | (() => string)> {
    const defaultVal = 'N/A';
    return {
      callId: chat.id.toString(),
      callDuration: callDetails?.callDuration?.toString() ?? defaultVal,
      callDate: new Date(chat.createdAt).toLocaleDateString(),
      callTime: new Date(chat.createdAt).toLocaleTimeString(),
      clientId: chat.clientId?.toString() ?? defaultVal,
      counsellor: counselor?.name ?? defaultVal,
      callType: summaryInfo.callType ?? defaultVal,
      age: summaryInfo.age?.toString() ?? defaultVal,
      gender: summaryInfo.gender ?? defaultVal,
      profession: summaryInfo.profession ?? defaultVal,
      relationshipStatus: summaryInfo.relationshipStatus ?? defaultVal,
      languages: () => this.formatLanguages(summaryInfo),
      location: summaryInfo.location ?? defaultVal,
      codeOfConcern: summaryInfo.codeOfConcern ?? defaultVal,
      sessionSummary: summaryInfo.sessionSummary ?? defaultVal,
      counselingProcessFlow: summaryInfo.counselingProcessFlow ?? defaultVal,
      keyConcerns: summaryInfo.keyConcerns ?? defaultVal,
      subjectiveObservations: summaryInfo.subjectiveObservations ?? defaultVal,
      objectiveObservations: summaryInfo.objectiveObservations ?? defaultVal,
      assessment: summaryInfo.assessment ?? defaultVal,
      dominantFeelings: summaryInfo.dominantFeelings ?? defaultVal,
      issuesWorkedOn: summaryInfo.issuesWorkedOn ?? defaultVal,
      keyTherapeuticTechniques:
        summaryInfo.keyTherapeuticTechniques ?? defaultVal,
      referralsProvided: summaryInfo.referralsProvided ?? defaultVal,
      homework: summaryInfo.homework ?? defaultVal,
      planForNextCall: summaryInfo.planForNextCall ?? defaultVal,
      tags: () => this.formatTags(summaryInfo),
      listeningShare:
        callDetails?.callInfo?.clientTalkingPercentage != null
          ? `${(callDetails.callInfo.clientTalkingPercentage * 100).toFixed(1)}%`
          : defaultVal,
      reflectiveQuestionsAsked:
        summaryInfo.reflectiveQuestionsAsked?.toString() ?? defaultVal,
      openEndedQuestionsAsked:
        summaryInfo.openEndedQuestionsAsked?.toString() ?? defaultVal,
      emotionalLift: summaryInfo.emotionalLift ?? defaultVal,
      callQuality: summaryInfo.callQuality?.toString() ?? defaultVal,
      newCallFollowUp: summaryInfo.newCallFollowUp ?? defaultVal,
    };
  }

  private renderField(
    field: string,
    displayNameMap: Record<string, string>,
    valueMap: Record<string, string | (() => string)>,
  ): string {
    const raw = valueMap[field];
    const v = typeof raw === 'function' ? raw() : raw;
    return `${displayNameMap[field] ?? field}: ${v ?? 'N/A'}`;
  }

  private renderSection(
    title: string,
    fields: string[],
    visibleFields: string[],
    displayNameMap: Record<string, string>,
    valueMap: Record<string, string | (() => string)>,
  ): string {
    const section = fields.filter((f) => visibleFields.includes(f));
    if (!section.length) return '';
    let out = `${title}\n${'='.repeat(title.length)}\n`;
    for (const f of section)
      out += `${this.renderField(f, displayNameMap, valueMap)}\n`;
    return out + '\n';
  }
}

import { Injectable } from '@nestjs/common';

@Injectable()
export class TrackEnrollmentService {
  getTracksForLearner(...args: any[]): any {}
  getTrackDetailForLearner(...args: any[]): any {}
  getTrackLanguages(...args: any[]): any {}
  setTrackLanguage(...args: any[]): any {}
  enroll(...args: any[]): any {}
  startItem(...args: any[]): any {}
  markArticleRead(...args: any[]): any {}
  submitArticleQuestionAnswer(...args: any[]): any {}
  reportVideoProgress(...args: any[]): any {}
  submitInterjectionAnswer(...args: any[]): any {}
  getNextItem(...args: any[]): any {}
  getPermittedItemProgress(...args: any[]): any {}
}

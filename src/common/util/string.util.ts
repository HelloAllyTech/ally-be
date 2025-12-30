export class StringUtil {
  static wordCount(str: string) {
    return (str.match(/\b\w+(?:'\w+)?\b/g) || []).length;
  }
}

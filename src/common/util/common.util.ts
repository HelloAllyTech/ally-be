import * as _ from 'lodash';

export class CommonUtil {
  static hasExactKeys(obj: any, reference: any) {
    if (!obj || !reference) return false;
    return _.isEqual(_.sortBy(_.keys(obj)), _.sortBy(_.keys(reference)));
  }

  static difference(
    obj: Record<string, any>,
    reference: Record<string, any>,
  ): string[] {
    if (!obj || !reference) return [];
    return _.difference(_.keys(obj), _.keys(reference));
  }

  static getInvalidKeys(obj: Record<string, any>, keys: string[]) {
    return keys.filter((key: string) => !(key in obj));
  }

  static getInvalidKeysFromSet(set: Set<string>, keys: string[]) {
    return keys.filter((key: string) => !set.has(key));
  }

  /**
   * Sets the given keys in an object to a specific value if they exist.
   *
   * @param {Object} obj - The target object to update.
   * @param {Array<string>} keys - An array of keys to update.
   * @param {*} value - The value to set for each key.
   * @returns {Object} The updated object (mutates original).
   */
  static setKeysToValue(
    obj: Record<string, any>,
    keys: string[],
    value: any,
  ): Record<string, any> {
    keys.forEach((key) => {
      if (_.has(obj, key)) {
        _.set(obj, key, value);
      }
    });
    return obj;
  }

  static removeFalseValues(obj: Record<string, any>): Record<string, any> {
    return _.pickBy(obj, (value) => value !== false);
  }

  static removeHiddenFields(obj: Record<string, any>, hiddenFields: string[]) {
    return _.omit(obj, hiddenFields);
  }

  /**
   * Recursively converts object keys from snake_case to camelCase.
   * Handles nested objects and arrays.
   * @param obj - The object, array, or primitive to convert
   * @returns The converted object with camelCase keys
   */
  static convertToCamelCase(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => CommonUtil.convertToCamelCase(item));
    } else if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj).reduce((acc, key) => {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
          letter.toUpperCase(),
        );
        acc[camelKey] = CommonUtil.convertToCamelCase(obj[key]);
        return acc;
      }, {} as any);
    }
    return obj;
  }

  static generateQueryParams(params: Record<string, any>) {
    return Object.entries(params)
      .map(
        ([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
      )
      .join('&');
  }
}

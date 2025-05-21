import * as _ from 'lodash';

export class CommonUtil {
  static hasExactKeys(obj: any, reference: any) {
    return _.isEqual(_.sortBy(_.keys(obj)), _.sortBy(_.keys(reference)));
  }

  static difference(obj: any, reference: any) {
    return _.difference(_.keys(obj), _.keys(reference));
  }

  static getInvalidKeys(obj: Record<string, any>, keys: string[]) {
    return keys.filter((key: string) => !(key in obj));
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
}

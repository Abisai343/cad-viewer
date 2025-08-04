import { AcGeBox2d, AcGeMatrix3d, AcGiEntity } from '@mlightcad/data-model'

/**
 * Represent the display object of one drawing entity.
 */
export class AcSvgEntity implements AcGiEntity {
  private _objectId: string
  private _ownerId: string
  private _layerName: string
  private _visible: boolean
  private _userData: object
  protected _box: AcGeBox2d
  private _svg: string

  constructor() {
    this._objectId = ''
    this._ownerId = ''
    this._layerName = ''
    this._visible = true
    this._userData = {}
    this._box = new AcGeBox2d()
    this._svg = ''
  }

  /**
   * The bounding box of this object
   */
  get box() {
    return this._box
  }
  set box(value: AcGeBox2d) {
    this._box.copy(value)
  }

  /**
   * SVG string of this entity
   */
  get svg() {
    return this._svg
  }
  set svg(value: string) {
    this._svg = value
  }

  /**
   * @inheritdoc
   */
  get objectId() {
    return this._objectId
  }
  set objectId(value: string) {
    this._objectId = value
  }

  /**
   * @inheritdoc
   */
  get ownerId() {
    return this._ownerId
  }
  set ownerId(value: string) {
    this._ownerId = value
  }

  /**
   * @inheritdoc
   */
  get layerName() {
    return this._layerName
  }
  set layerName(value: string) {
    this._layerName = value
  }

  /**
   * @inheritdoc
   */
  get visible() {
    return this._visible
  }
  set visible(value: boolean) {
    this._visible = value
  }

  /**
   * @inheritdoc
   */
  get userData(): object {
    return this._userData
  }
  set userData(value: object) {
    this._userData = value
  }

  /**
   * @inheritdoc
   */
  applyMatrix(_matrix: AcGeMatrix3d) {
    // Do nothing
  }

  /**
   * @inheritdoc
   */
  recomputeBoundingBox() {
    // Do nothing
  }

  /**
   * @inheritdoc
   */
  highlight() {
    // Do nothing
  }

  /**
   * @inheritdoc
   */
  unhighlight() {
    // Do nothing
  }

  /**
   * @inheritdoc
   */
  fastDeepClone() {
    // TODO: Implement it correctly
    return this
  }
}

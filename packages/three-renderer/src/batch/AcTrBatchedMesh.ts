import * as THREE from 'three'

import { AcTrCommonUtil } from '../util/AcTrCommonUtil'
import {
  AcTrBatchedGeometryInfo,
  AcTrBatchGeometryUserData,
  ascIdSort,
  copyArrayContents,
  copyAttributeData
} from './AcTrBatchedGeometryInfo'

const _box = /*@__PURE__*/ new THREE.Box3()
const _vector = /*@__PURE__*/ new THREE.Vector3()
const _raycastObject = /*@__PURE__*/ new THREE.Mesh()
const _batchIntersects: THREE.Intersection[] = []

export class AcTrBatchedMesh extends THREE.Mesh {
  boundingBox: THREE.Box3 | null = null
  boundingSphere: THREE.Sphere | null = null

  // cached user options
  private _maxVertexCount: number
  private _maxIndexCount: number

  // stores visible, active, and geometry id and reserved buffer ranges for geometries
  private _geometryInfo: AcTrBatchedGeometryInfo[] = []
  // geometry ids that have been set as inactive, and are available to be overwritten
  private _availableGeometryIds: number[] = []

  // used to track where the next point is that geometry should be inserted
  private _nextIndexStart = 0
  private _nextVertexStart = 0
  private _geometryCount = 0

  // flags
  private _geometryInitialized = false

  constructor(
    maxVertexCount: number = 1000,
    maxIndexCount: number = maxVertexCount * 2,
    material?: THREE.Material
  ) {
    super(new THREE.BufferGeometry(), material)
    this.frustumCulled = false

    // cached user options
    this._maxVertexCount = maxVertexCount
    this._maxIndexCount = maxIndexCount
  }

  get unusedVertexCount() {
    return this._maxVertexCount - this._nextVertexStart
  }

  get unusedIndexCount() {
    return this._maxIndexCount - this._nextIndexStart
  }

  get mappingStats() {
    const count = this._geometryInfo.length
    let size = 0
    if (count > 0) {
      size = AcTrCommonUtil.estimateObjectSize(this._geometryInfo[0])
    }

    return {
      count: count,
      size: count * size
    }
  }

  private _initializeGeometry(reference: THREE.BufferGeometry) {
    const geometry = this.geometry
    const maxVertexCount = this._maxVertexCount
    const maxIndexCount = this._maxIndexCount
    if (this._geometryInitialized === false) {
      for (const attributeName in reference.attributes) {
        const srcAttribute = reference.getAttribute(attributeName)
        const { array, itemSize, normalized } = srcAttribute

        // @ts-expect-error no good way to remove this type error
        const dstArray = new array.constructor(maxVertexCount * itemSize)
        const dstAttribute = new THREE.BufferAttribute(
          dstArray,
          itemSize,
          normalized
        )

        geometry.setAttribute(attributeName, dstAttribute)
      }

      if (reference.getIndex() !== null) {
        // Reserve last u16 index for primitive restart.
        const indexArray =
          maxVertexCount > 65535
            ? new Uint32Array(maxIndexCount)
            : new Uint16Array(maxIndexCount)

        geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
      }

      this._geometryInitialized = true
    }
  }

  // Make sure the geometry is compatible with the existing combined geometry attributes
  private _validateGeometry(geometry: THREE.BufferGeometry) {
    // check to ensure the geometries are using consistent attributes and indices
    const batchGeometry = this.geometry
    if (Boolean(geometry.getIndex()) !== Boolean(batchGeometry.getIndex())) {
      throw new Error(
        'AcTrBatchedMesh: All geometries must consistently have "index".'
      )
    }

    for (const attributeName in batchGeometry.attributes) {
      if (!geometry.hasAttribute(attributeName)) {
        throw new Error(
          `AcTrBatchedMesh: Added geometry missing "${attributeName}". All geometries must have consistent attributes.`
        )
      }

      const srcAttribute = geometry.getAttribute(attributeName)
      const dstAttribute = batchGeometry.getAttribute(attributeName)
      if (
        srcAttribute.itemSize !== dstAttribute.itemSize ||
        srcAttribute.normalized !== dstAttribute.normalized
      ) {
        throw new Error(
          'AcTrBatchedMesh: All attributes must have a consistent itemSize and normalized value.'
        )
      }
    }
  }

  private _resizeSpaceIfNeeded(geometry: THREE.BufferGeometry) {
    const index = geometry.getIndex()
    const hasIndex = index !== null
    let newMaxIndexCount = this._maxIndexCount
    if (hasIndex) {
      if (this.unusedIndexCount < index.count) {
        newMaxIndexCount = (this._maxIndexCount + index.count) * 1.5
      }
    }

    const positionAttribute = geometry.getAttribute('position')
    let newMaxVertexCount = this._maxVertexCount
    if (positionAttribute) {
      if (this.unusedVertexCount < positionAttribute.count) {
        newMaxVertexCount =
          (this._maxVertexCount + positionAttribute.count) * 1.5
      }
    }

    if (
      newMaxIndexCount > this._maxIndexCount ||
      newMaxVertexCount > this._maxVertexCount
    ) {
      this.setGeometrySize(newMaxVertexCount, newMaxIndexCount)
    }
  }

  validateGeometryId(geometryId: number) {
    const geometryInfoList = this._geometryInfo
    if (
      geometryId < 0 ||
      geometryId >= geometryInfoList.length ||
      geometryInfoList[geometryId].active === false
    ) {
      throw new Error(
        `AcTrBatchedMesh: Invalid geometryId ${geometryId}. Geometry is either out of range or has been deleted.`
      )
    }
  }

  computeBoundingBox() {
    if (this.boundingBox === null) {
      this.boundingBox = new THREE.Box3()
    }

    const boundingBox = this.boundingBox
    const geometryInfo = this._geometryInfo
    boundingBox.makeEmpty()
    for (let i = 0, l = geometryInfo.length; i < l; i++) {
      const geometry = geometryInfo[i]
      if (geometry.active === false) continue
      if (geometry.boundingBox != null) {
        boundingBox.union(geometry.boundingBox)
      }
    }
  }

  computeBoundingSphere() {
    if (this.boundingSphere === null) {
      this.boundingSphere = new THREE.Sphere()
    }

    const boundingSphere = this.boundingSphere
    const geometryInfo = this._geometryInfo
    boundingSphere.makeEmpty()
    for (let i = 0, l = geometryInfo.length; i < l; i++) {
      const geometry = geometryInfo[i]
      if (geometry.active === false) continue
      if (geometry.boundingSphere != null) {
        boundingSphere.union(geometry.boundingSphere)
      }
    }
  }

  addGeometry(
    geometry: THREE.BufferGeometry,
    reservedVertexCount: number = -1,
    reservedIndexCount: number = -1
  ) {
    this._initializeGeometry(geometry)
    this._validateGeometry(geometry)

    if (geometry.boundingBox == null) {
      geometry.computeBoundingBox()
    }
    if (geometry.boundingSphere == null) {
      geometry.computeBoundingSphere()
    }

    this._resizeSpaceIfNeeded(geometry)

    const geometryInfo: AcTrBatchedGeometryInfo = {
      // geometry information
      vertexStart: -1,
      vertexCount: -1,
      reservedVertexCount: -1,

      indexStart: -1,
      indexCount: -1,
      reservedIndexCount: -1,

      // draw range information
      start: -1,
      count: -1,

      // state
      boundingBox: geometry.boundingBox,
      boundingSphere: geometry.boundingSphere,
      active: true,
      visible: true
    }

    const geometryInfoList = this._geometryInfo
    geometryInfo.vertexStart = this._nextVertexStart
    geometryInfo.reservedVertexCount =
      reservedVertexCount === -1
        ? geometry.getAttribute('position').count
        : reservedVertexCount

    const index = geometry.getIndex()
    const hasIndex = index !== null
    if (hasIndex) {
      geometryInfo.indexStart = this._nextIndexStart
      geometryInfo.reservedIndexCount =
        reservedIndexCount === -1 ? index.count : reservedIndexCount
    }

    if (
      (geometryInfo.indexStart !== -1 &&
        geometryInfo.indexStart + geometryInfo.reservedIndexCount >
          this._maxIndexCount) ||
      geometryInfo.vertexStart + geometryInfo.reservedVertexCount >
        this._maxVertexCount
    ) {
      throw new Error(
        'AcTrBatchedMesh: Reserved space request exceeds the maximum buffer size.'
      )
    }

    // update id
    let geometryId
    if (this._availableGeometryIds.length > 0) {
      this._availableGeometryIds.sort(ascIdSort)

      geometryId = this._availableGeometryIds.shift() as number
      geometryInfoList[geometryId] = geometryInfo
    } else {
      geometryId = this._geometryCount
      this._geometryCount++
      geometryInfoList.push(geometryInfo)
    }

    // update the geometry
    this.setGeometryAt(geometryId, geometry)

    // increment the next geometry position
    this._nextIndexStart =
      geometryInfo.indexStart + geometryInfo.reservedIndexCount
    this._nextVertexStart =
      geometryInfo.vertexStart + geometryInfo.reservedVertexCount

    return geometryId
  }

  setGeometryInfo(geometryId: number, userData: AcTrBatchGeometryUserData) {
    if (geometryId >= this._geometryCount) {
      throw new Error('AcTrBatchedMesh: Maximum geometry count reached.')
    }
    const geometryInfo = this._geometryInfo[geometryId]
    geometryInfo.objectId = userData.objectId
    geometryInfo.bboxIntersectionCheck = userData.bboxIntersectionCheck
  }

  setGeometryAt(geometryId: number, geometry: THREE.BufferGeometry) {
    if (geometryId >= this._geometryCount) {
      throw new Error('AcTrBatchedMesh: Maximum geometry count reached.')
    }

    this._validateGeometry(geometry)

    const batchGeometry = this.geometry
    const hasIndex = batchGeometry.getIndex() !== null
    const dstIndex = batchGeometry.getIndex()
    const srcIndex = geometry.getIndex()!
    const geometryInfo = this._geometryInfo[geometryId]
    if (
      (hasIndex && srcIndex.count > geometryInfo.reservedIndexCount) ||
      geometry.attributes.position.count > geometryInfo.reservedVertexCount
    ) {
      throw new Error(
        'AcTrBatchedMesh: Reserved space not large enough for provided geometry.'
      )
    }

    // copy geometry buffer data over
    const vertexStart = geometryInfo.vertexStart
    const reservedVertexCount = geometryInfo.reservedVertexCount
    geometryInfo.vertexCount = geometry.getAttribute('position').count

    for (const attributeName in batchGeometry.attributes) {
      // copy attribute data
      const srcAttribute = geometry.getAttribute(attributeName)
      const dstAttribute = batchGeometry.getAttribute(
        attributeName
      ) as THREE.BufferAttribute
      copyAttributeData(srcAttribute, dstAttribute, vertexStart)

      // fill the rest in with zeroes
      const itemSize = srcAttribute.itemSize
      for (let i = srcAttribute.count, l = reservedVertexCount; i < l; i++) {
        const index = vertexStart + i
        for (let c = 0; c < itemSize; c++) {
          dstAttribute.setComponent(index, c, 0)
        }
      }

      dstAttribute.needsUpdate = true
      dstAttribute.addUpdateRange(
        vertexStart * itemSize,
        reservedVertexCount * itemSize
      )
    }

    // copy index
    if (hasIndex && dstIndex) {
      const indexStart = geometryInfo.indexStart
      const reservedIndexCount = geometryInfo.reservedIndexCount
      geometryInfo.indexCount = geometry.getIndex()!.count

      // copy index data over
      for (let i = 0; i < srcIndex.count; i++) {
        dstIndex.setX(indexStart + i, vertexStart + srcIndex.getX(i))
      }

      // fill the rest in with zeroes
      for (let i = srcIndex.count, l = reservedIndexCount; i < l; i++) {
        dstIndex.setX(indexStart + i, vertexStart)
      }

      dstIndex.needsUpdate = true
      dstIndex.addUpdateRange(indexStart, geometryInfo.reservedIndexCount)
    }

    // update the draw range
    geometryInfo.start = hasIndex
      ? geometryInfo.indexStart
      : geometryInfo.vertexStart
    geometryInfo.count = hasIndex
      ? geometryInfo.indexCount
      : geometryInfo.vertexCount

    // store the bounding boxes
    geometryInfo.boundingBox = null
    if (geometry.boundingBox !== null) {
      geometryInfo.boundingBox = geometry.boundingBox.clone()
    }

    geometryInfo.boundingSphere = null
    if (geometry.boundingSphere !== null) {
      geometryInfo.boundingSphere = geometry.boundingSphere.clone()
    }

    return geometryId
  }

  deleteGeometry(geometryId: number) {
    const geometryInfoList = this._geometryInfo
    if (
      geometryId >= geometryInfoList.length ||
      geometryInfoList[geometryId].active === false
    ) {
      return this
    }

    geometryInfoList[geometryId].active = false
    this._availableGeometryIds.push(geometryId)

    return this
  }

  optimize() {
    // track the next indices to copy data to
    let nextVertexStart = 0
    let nextIndexStart = 0

    // Iterate over all geometry ranges in order sorted from earliest in the geometry buffer to latest
    // in the geometry buffer. Because draw range objects can be reused there is no guarantee of their order.
    const geometryInfoList = this._geometryInfo
    const indices = geometryInfoList
      .map((_e, i) => i)
      .sort((a, b) => {
        return geometryInfoList[a].vertexStart - geometryInfoList[b].vertexStart
      })

    const geometry = this.geometry
    for (let i = 0, l = geometryInfoList.length; i < l; i++) {
      // if a geometry range is inactive then don't copy anything
      const index = indices[i]
      const geometryInfo = geometryInfoList[index]
      if (geometryInfo.active === false) {
        continue
      }

      // if a geometry contains an index buffer then shift it, as well
      if (geometry.index !== null) {
        if (geometryInfo.indexStart !== nextIndexStart) {
          const { indexStart, vertexStart, reservedIndexCount } = geometryInfo
          const index = geometry.index
          const array = index.array

          // shift the index pointers based on how the vertex data will shift
          // adjusting the index must happen first so the original vertex start value is available
          const elementDelta = nextVertexStart - vertexStart
          for (let j = indexStart; j < indexStart + reservedIndexCount; j++) {
            array[j] = array[j] + elementDelta
          }

          index.array.copyWithin(
            nextIndexStart,
            indexStart,
            indexStart + reservedIndexCount
          )
          index.addUpdateRange(nextIndexStart, reservedIndexCount)

          geometryInfo.indexStart = nextIndexStart
        }

        nextIndexStart += geometryInfo.reservedIndexCount
      }

      // if a geometry needs to be moved then copy attribute data to overwrite unused space
      if (geometryInfo.vertexStart !== nextVertexStart) {
        const { vertexStart, reservedVertexCount } = geometryInfo
        const attributes = geometry.attributes
        for (const key in attributes) {
          const attribute = attributes[key] as THREE.BufferAttribute
          const { array, itemSize } = attribute
          array.copyWithin(
            nextVertexStart * itemSize,
            vertexStart * itemSize,
            (vertexStart + reservedVertexCount) * itemSize
          )
          attribute.addUpdateRange(
            nextVertexStart * itemSize,
            reservedVertexCount * itemSize
          )
        }

        geometryInfo.vertexStart = nextVertexStart
      }

      nextVertexStart += geometryInfo.reservedVertexCount
      geometryInfo.start = geometry.index
        ? geometryInfo.indexStart
        : geometryInfo.vertexStart

      // step the next geometry points to the shifted position
      this._nextIndexStart = geometry.index
        ? geometryInfo.indexStart + geometryInfo.reservedIndexCount
        : 0
      this._nextVertexStart =
        geometryInfo.vertexStart + geometryInfo.reservedVertexCount
    }

    return this
  }

  // get bounding box and compute it if it doesn't exist
  getBoundingBoxAt(geometryId: number, target: THREE.Box3) {
    if (geometryId >= this._geometryCount) {
      return null
    }

    // compute bounding box
    const geometry = this.geometry
    const geometryInfo = this._geometryInfo[geometryId]
    if (geometryInfo.boundingBox === null) {
      const box = new THREE.Box3()
      const index = geometry.index
      const position = geometry.attributes.position
      for (
        let i = geometryInfo.start, l = geometryInfo.start + geometryInfo.count;
        i < l;
        i++
      ) {
        let iv = i
        if (index) {
          iv = index.getX(iv)
        }

        box.expandByPoint(_vector.fromBufferAttribute(position, iv))
      }

      geometryInfo.boundingBox = box
    }

    target.copy(geometryInfo.boundingBox)
    return target
  }

  // get bounding sphere and compute it if it doesn't exist
  getBoundingSphereAt(geometryId: number, target: THREE.Sphere) {
    if (geometryId >= this._geometryCount) {
      return null
    }

    // compute bounding sphere
    const geometry = this.geometry
    const geometryInfo = this._geometryInfo[geometryId]
    if (geometryInfo.boundingSphere === null) {
      const sphere = new THREE.Sphere()
      this.getBoundingBoxAt(geometryId, _box)
      _box.getCenter(sphere.center)

      const index = geometry.index
      const position = geometry.attributes.position

      let maxRadiusSq = 0
      for (
        let i = geometryInfo.start, l = geometryInfo.start + geometryInfo.count;
        i < l;
        i++
      ) {
        let iv = i
        if (index) {
          iv = index.getX(iv)
        }

        _vector.fromBufferAttribute(position, iv)
        maxRadiusSq = Math.max(
          maxRadiusSq,
          sphere.center.distanceToSquared(_vector)
        )
      }

      sphere.radius = Math.sqrt(maxRadiusSq)
      geometryInfo.boundingSphere = sphere
    }

    target.copy(geometryInfo.boundingSphere)
    return target
  }

  setVisibleAt(geometryId: number, value: boolean) {
    this.validateGeometryId(geometryId)

    if (this._geometryInfo[geometryId].visible === value) {
      return this
    }

    this._geometryInfo[geometryId].visible = value

    return this
  }

  getVisibleAt(geometryId: number) {
    this.validateGeometryId(geometryId)
    return this._geometryInfo[geometryId].visible
  }

  getGeometryRangeAt(geometryId: number) {
    this.validateGeometryId(geometryId)
    return this._geometryInfo[geometryId]
  }

  setGeometrySize(maxVertexCount: number, maxIndexCount: number) {
    // dispose of the previous geometry
    const oldGeometry = this.geometry
    oldGeometry.dispose()

    // recreate the geometry needed based on the previous variant
    this._maxVertexCount = maxVertexCount
    this._maxIndexCount = maxIndexCount

    if (this._geometryInitialized) {
      this._geometryInitialized = false
      this.geometry = new THREE.BufferGeometry()
      this._initializeGeometry(oldGeometry)
    }

    // copy data from the previous geometry
    const geometry = this.geometry
    if (oldGeometry.index) {
      copyArrayContents(oldGeometry.index.array, geometry.index!.array)
    }

    for (const key in oldGeometry.attributes) {
      copyArrayContents(
        oldGeometry.attributes[key].array,
        geometry.attributes[key].array
      )
    }
  }

  getObjectAt(batchId: number) {
    const object = new THREE.Mesh()
    this._initializeRaycastObject(object)
    const geometryInfo = this._geometryInfo[batchId]
    this._setRaycastObjectInfo(
      object,
      batchId,
      geometryInfo.start,
      geometryInfo.count
    )
    return object
  }

  private _initializeRaycastObject(raycastObject: THREE.Mesh) {
    const batchGeometry = this.geometry
    raycastObject.material = this.material
    raycastObject.geometry.index = batchGeometry.index
    raycastObject.geometry.attributes = batchGeometry.attributes
    if (raycastObject.geometry.boundingBox === null) {
      raycastObject.geometry.boundingBox = new THREE.Box3()
    }

    if (raycastObject.geometry.boundingSphere === null) {
      raycastObject.geometry.boundingSphere = new THREE.Sphere()
    }
    return raycastObject
  }

  private _setRaycastObjectInfo(
    raycastObject: THREE.Mesh,
    index: number,
    start: number,
    count: number
  ) {
    raycastObject.geometry.setDrawRange(start, count)

    // get the intersects
    this.getBoundingBoxAt(index, raycastObject.geometry.boundingBox!)
    this.getBoundingSphereAt(index, raycastObject.geometry.boundingSphere!)
  }

  private _resetRaycastObjectInfo(raycastObject: THREE.Mesh) {
    raycastObject.geometry.index = null
    raycastObject.geometry.attributes = {}
    raycastObject.geometry.setDrawRange(0, Infinity)
  }

  intersectWith(
    geometryId: number,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[]
  ) {
    this._initializeRaycastObject(_raycastObject)
    this._intersectWith(geometryId, raycaster, intersects)
    this._resetRaycastObjectInfo(_raycastObject)
  }

  private _intersectWith(
    geometryId: number,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[]
  ) {
    const geometryInfo = this._geometryInfo[geometryId]
    if (!geometryInfo.visible || !geometryInfo.active) {
      return
    }

    if (geometryInfo.bboxIntersectionCheck) {
      const box = geometryInfo.boundingBox

      // Check for intersection with the bounding box
      if (raycaster.ray.intersectBox(box!, _vector)) {
        const distance = raycaster.ray.origin.distanceTo(_vector)
        // Push intersection details
        intersects.push({
          distance: distance,
          point: _vector.clone(),
          object: this,
          face: null,
          faceIndex: undefined,
          uv: undefined,
          batchId: geometryId,
          // @ts-expect-error THREE.Intersection doesn't have property 'objectId'
          objectId: geometryInfo.objectId
        })
      }
    } else {
      this._setRaycastObjectInfo(
        _raycastObject,
        geometryId,
        geometryInfo.start,
        geometryInfo.count
      )
      _raycastObject.raycast(raycaster, _batchIntersects)

      // add batch id to the intersects
      for (let j = 0, l = _batchIntersects.length; j < l; j++) {
        const intersect = _batchIntersects[j]
        intersect.object = this
        intersect.batchId = geometryId
        // @ts-expect-error THREE.Intersection doesn't have property 'objectId'
        intersect.objectId = geometryInfo.objectId
        intersects.push(intersect)
      }

      _batchIntersects.length = 0
    }
  }

  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    const geometryInfoList = this._geometryInfo
    this._initializeRaycastObject(_raycastObject)

    for (let i = 0, l = geometryInfoList.length; i < l; i++) {
      this._intersectWith(i, raycaster, intersects)
    }
    this._resetRaycastObjectInfo(_raycastObject)
  }

  copy(source: AcTrBatchedMesh) {
    super.copy(source)

    this.geometry = source.geometry.clone()
    this.boundingBox =
      source.boundingBox !== null ? source.boundingBox.clone() : null
    this.boundingSphere =
      source.boundingSphere !== null ? source.boundingSphere.clone() : null

    this._geometryInfo = source._geometryInfo.map(info => ({
      ...info,

      boundingBox: info.boundingBox !== null ? info.boundingBox.clone() : null,
      boundingSphere:
        info.boundingSphere !== null ? info.boundingSphere.clone() : null
    }))

    this._maxVertexCount = source._maxVertexCount
    this._maxIndexCount = source._maxIndexCount

    this._geometryInitialized = source._geometryInitialized
    this._geometryCount = source._geometryCount

    return this
  }

  dispose() {
    // Assuming the geometry is not shared with other meshes
    this.geometry.dispose()
    return this
  }
}

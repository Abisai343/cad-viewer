import { AcGePoint3dLike, AcGiPointStyle } from '@mlightcad/data-model'
import * as THREE from 'three'

import { AcTrPointSymbolCreator } from '../geometry/AcTrPointSymbolCreator'
import { AcTrStyleManager } from '../style/AcTrStyleManager'
import { AcTrEntity } from './AcTrEntity'

const _vector3 = /*@__PURE__*/ new THREE.Vector3()

export class AcTrPoint extends AcTrEntity {
  /**
   * The flag whether to use one point using THREE.Points
   */
  isShowPoint: boolean

  constructor(
    point: AcGePoint3dLike,
    style: AcGiPointStyle,
    styleManager: AcTrStyleManager
  ) {
    super(styleManager)
    const pointSymbol = AcTrPointSymbolCreator.instance.create(
      style.displayMode,
      point
    )

    this.isShowPoint = pointSymbol.point != null

    // Always create one THREE.Points object. If 'isShowPoint' is true, show it. Otherwise, hide it.
    const geometry =
      pointSymbol.point ??
      new THREE.BufferGeometry().setFromPoints([_vector3.copy(point)])
    geometry.computeBoundingBox()
    if (geometry.boundingBox) this.box.union(geometry.boundingBox)
    const material = this.styleManager.getPointsMaterial(style.color)
    const pointObj = new THREE.Points(geometry, material)
    // Add the flag to check intersection using bounding box of the mesh
    pointObj.userData.bboxIntersectionCheck = true
    pointObj.visible = this.isShowPoint
    this.add(pointObj)

    if (pointSymbol.line) {
      const geometry = pointSymbol.line
      geometry.computeBoundingBox()
      if (geometry.boundingBox) this.box.union(geometry.boundingBox)
      const material = this.styleManager.getLineBasicMaterial(style.color)
      const lineSegmentsObj = new THREE.LineSegments(geometry, material)
      // Add the flag to check intersection using bounding box of the mesh
      lineSegmentsObj.userData.bboxIntersectionCheck = true
      // Add this flag so that batched group can handle it with different logic
      lineSegmentsObj.userData.isPoint = true
      lineSegmentsObj.userData.position = { x: point.x, y: point.y, z: point.z }
      this.add(lineSegmentsObj)
    }
  }
}

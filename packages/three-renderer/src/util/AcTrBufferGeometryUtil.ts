import { AcGePoint3dLike } from '@mlightcad/data-model'
import * as THREE from 'three'

const _vector1 = /*@__PURE__*/ new THREE.Vector3()
const _vector2 = /*@__PURE__*/ new THREE.Vector3()

/**
 * Internal utility class to handle buffer geometry.
 * @internal
 */
export class AcTrBufferGeometryUtil {
  /**
   * Release memeory occupied by buffer geometry
   * @param geometry
   */
  public static release(geometry: THREE.BufferGeometry) {
    geometry.index = null
    geometry.attributes = {}
  }

  /**
   * Convert an indexed geometry to a non-indexed geometry. Can be used for dashed line style.
   */
  public static toNonIndexed(
    geometry: THREE.BufferGeometry
  ): THREE.BufferGeometry {
    if (!geometry.index) {
      return geometry
    }

    const newGeometry = new THREE.BufferGeometry()
    const indexBuffer = geometry.index
    for (const name in geometry.attributes) {
      newGeometry.setAttribute(
        name,
        AcTrBufferGeometryUtil.createGeometryAttributeByIndex(
          geometry.attributes[name] as THREE.BufferAttribute,
          indexBuffer
        )
      )
    }

    return newGeometry
  }

  public static createGeometryAttributeByIndex(
    attribute: THREE.BufferAttribute,
    indexBuffer: THREE.BufferAttribute
  ) {
    const count = indexBuffer.count
    const itemSize = attribute.itemSize
    const TypedArray = attribute.array.constructor as {
      new (length: number): typeof attribute.array
    }
    const array = new TypedArray(count * itemSize)

    for (let i = 0; i < count; i++) {
      const index = indexBuffer.getX(i)
      const attributeIndex = index * itemSize
      for (let k = 0; k < itemSize; k++) {
        array[i * itemSize + k] = attribute.array[attributeIndex + k]
      }
    }

    return new THREE.BufferAttribute(array, itemSize, attribute.normalized)
  }

  /**
   * Converts InterleavedBufferAttribute to BufferAttribute, because mergeGeometries doesn't support InterleavedBufferAttribute.
   * If it is supported by Three.js one day, we should remove this method.
   */
  public static tryConvertInterleavedBufferAttributes(
    geometry: THREE.BufferGeometry
  ) {
    if (!geometry || !geometry.attributes) {
      return
    }
    Object.keys(geometry.attributes).forEach(key => {
      const val = geometry.attributes[key]
      if (val instanceof THREE.InterleavedBufferAttribute) {
        const bufferAttr = val.clone() // returns THREE.BufferAttribute
        geometry.attributes[key] = bufferAttr
      }
    })
  }

  static createBufferGeometryByPoints(points: AcGePoint3dLike[]) {
    const geometry = new THREE.BufferGeometry()
    const position = new Float32Array(points.length * 3)
    const indices = new Uint16Array((points.length - 1) * 2)
    points.forEach((point, index) => {
      let startIndex = index * 3
      position[startIndex] = point.x
      position[startIndex + 1] = point.y
      position[startIndex + 2] = point.z
      if (index > 0) {
        startIndex = (index - 1) * 2
        indices[startIndex] = index - 1
        indices[startIndex + 1] = index
      }
    })
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(position, 3)
    )
    geometry.setIndex(new THREE.Uint16BufferAttribute(indices, 1))
    return geometry
  }

  // Calculates line distances in world space
  static computeLineDistance(line: THREE.Line) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isLineSegments = (line as any).isLineSegments === true
    let geometry = line.geometry
    const worldMatrix = line.matrixWorld
    // Converts an indexed geometry to an non-indexed geometry
    if (geometry.index) {
      geometry = AcTrBufferGeometryUtil.toNonIndexed(geometry)
    }

    // TODO: geometry may be referenced by multiple objects.
    if (geometry.index === null) {
      const positionAttribute = geometry.attributes
        .position as THREE.BufferAttribute
      if (!positionAttribute || positionAttribute.count === 0) {
        return
      }
      const lineDistances: number[] = []

      if (isLineSegments) {
        for (let i = 0, l = positionAttribute.count; i < l; i += 2) {
          _vector1
            .fromBufferAttribute(positionAttribute, i)
            .applyMatrix4(worldMatrix)
          _vector2
            .fromBufferAttribute(positionAttribute, i + 1)
            .applyMatrix4(worldMatrix)

          lineDistances[i] = i === 0 ? 0 : lineDistances[i - 1]
          lineDistances[i + 1] =
            lineDistances[i] + _vector1.distanceTo(_vector2)
        }
      } else {
        lineDistances[0] = 0
        for (let i = 1, l = positionAttribute.count; i < l; i++) {
          _vector1
            .fromBufferAttribute(positionAttribute, i - 1)
            .applyMatrix4(worldMatrix)
          _vector2
            .fromBufferAttribute(positionAttribute, i)
            .applyMatrix4(worldMatrix)

          lineDistances[i] = lineDistances[i - 1]
          lineDistances[i] += _vector1.distanceTo(_vector2)
        }
      }

      geometry.setAttribute(
        'lineDistance',
        new THREE.Float32BufferAttribute(lineDistances, 1)
      )
      line.geometry.dispose()
      line.geometry = geometry
    }
  }

  static computeLineDistances(object: THREE.Object3D) {
    object.traverse((object: THREE.Object3D) => {
      let obj = object as any //eslint-disable-line
      if (obj.isLine && obj.material instanceof THREE.ShaderMaterial) {
        this.computeLineDistance(obj)
      }
    })
  }

  /**
   * Apply translation and rotation around z-axis to 2d points in the specified buffer geometry
   * @param geometry Input buffer geoemtry to apply translation and rotation
   * @param translation Input translation to apply
   * @param rotationZ Input roatation (in radians) around z-axis to apply
   * @param scale Input scale factor
   */
  static apply2dTransform(
    geometry: THREE.BufferGeometry,
    translation: THREE.Vector2,
    rotationZ: number = 0,
    scale: number = 1
  ) {
    const positionAttribute = geometry.attributes.position // Access vertex positions
    const itemSize = positionAttribute.itemSize
    const array = positionAttribute.array // Direct access to Float32Array for faster processing

    if (rotationZ != 0) {
      const cosAngle = Math.cos(rotationZ)
      const sinAngle = Math.sin(rotationZ)

      // Loop through all vertex positions (x, y) in the array
      for (let i = 0; i < array.length; i += itemSize) {
        const x = array[i]
        const y = array[i + 1]

        // Apply 2D rotation around Z-axis
        const xNew = x * cosAngle - y * sinAngle
        const yNew = x * sinAngle + y * cosAngle

        // Apply translation
        array[i] = xNew * scale + translation.x // Update x coordinate
        array[i + 1] = yNew * scale + translation.y // Update y coordinate
        // No need to modify array[i + 2], which is z (remains 0)
      }
    } else {
      // Loop through all vertex positions (x, y) in the array
      for (let i = 0; i < array.length; i += itemSize) {
        // Apply translation
        array[i] = array[i] * scale + translation.x // Update x coordinate
        array[i + 1] += array[i + 1] * scale + translation.y // Update y coordinate
        // No need to modify array[i + 2], which is z (remains 0)
      }
    }

    // Mark the position attribute as needing update
    positionAttribute.needsUpdate = true

    return geometry
  }

  /**
   * Apply translation and rotation to 2d points in the specified buffer geometry
   * @param geometry Input buffer geoemtry to apply translation and rotation
   * @param translation Input translation to apply
   * @param rotation Input roatation (in radians) around x-axis, y-axis, and z-axis
   */
  static apply3dTransform(
    geometry: THREE.BufferGeometry,
    translation: THREE.Vector3,
    rotation: THREE.Vector3
  ) {
    const positionAttribute = geometry.attributes.position // Access vertex positions
    const itemSize = positionAttribute.itemSize
    const array = positionAttribute.array // Direct access to Float32Array for faster processing

    const cosX = Math.cos(rotation.x)
    const sinX = Math.sin(rotation.x)

    const cosY = Math.cos(rotation.y)
    const sinY = Math.sin(rotation.y)

    const cosZ = Math.cos(rotation.z)
    const sinZ = Math.sin(rotation.z)

    // Loop through all vertex positions (x, y, z) in the array
    for (let i = 0; i < array.length; i += itemSize) {
      let x = array[i]
      let y = array[i + 1]
      let z = array[i + 2]

      // Rotation around X-axis
      let yNew = y * cosX - z * sinX
      let zNew = y * sinX + z * cosX
      y = yNew
      z = zNew

      // Rotation around Y-axis
      let xNew = x * cosY + z * sinY
      zNew = -x * sinY + z * cosY
      x = xNew
      z = zNew

      // Rotation around Z-axis
      xNew = x * cosZ - y * sinZ
      yNew = x * sinZ + y * cosZ
      x = xNew
      y = yNew

      // Apply translation
      array[i] = x + translation.x // Update x coordinate
      array[i + 1] = y + translation.y // Update y coordinate
      array[i + 2] = z + translation.z // Update z coordinate
    }

    // Mark the position attribute as needing update
    positionAttribute.needsUpdate = true

    return geometry
  }
}

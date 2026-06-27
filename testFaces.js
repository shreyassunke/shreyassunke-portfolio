import * as THREE from 'three';

const geometry = new THREE.IcosahedronGeometry(1.2, 0);

const posAttr = geometry.attributes.position;
const indexAttr = geometry.index;
const faces = [];

if (indexAttr) {
  for (let i = 0; i < indexAttr.count; i += 3) {
    const a = indexAttr.getX(i);
    const b = indexAttr.getX(i+1);
    const c = indexAttr.getX(i+2);
    faces.push([
      new THREE.Vector3(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a)),
      new THREE.Vector3(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b)),
      new THREE.Vector3(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c))
    ]);
  }
} else {
  for (let i = 0; i < posAttr.count; i += 3) {
    faces.push([
      new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)),
      new THREE.Vector3(posAttr.getX(i+1), posAttr.getY(i+1), posAttr.getZ(i+1)),
      new THREE.Vector3(posAttr.getX(i+2), posAttr.getY(i+2), posAttr.getZ(i+2))
    ]);
  }
}

console.log("faces length:", faces.length);
if (faces.length > 0) {
    console.log("first face centroid:", new THREE.Vector3().addVectors(faces[0][0], faces[0][1]).add(faces[0][2]).divideScalar(3));
}

let scene, camera, renderer, controls, particleSystem;
let audioContext, oscillator, gainNode;
let selectedParticles = [];
let isInteracting = false;
let isPlaying = false;
let raycaster, pointer;
let rotationSpeed = 0.001;
let neuronLines = [];
let pointerX = 0;
let pointerY = 0;
let isDragging = false;

const COLORS = [0xffb3ba, 0xffdfba, 0xffffba, 0xbaffc9, 0xbae1ff, 0xd4baff, 0xf8baff];
const notes = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88]; // C4 到 B4 的频率

const SCALES = {
    pentatonic: [0, 2, 4, 7, 9],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    wholetone: [0, 2, 4, 6, 8, 10]
};
const BASE_FREQUENCY = 55; // A1，更低的基础频率
let currentScale = SCALES.pentatonic;
let audioNodes = [];

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000);
    document.body.appendChild(renderer.domElement);
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false;
    
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    
    createParticles();
    
    renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
    renderer.domElement.addEventListener('pointermove', onPointerMove, false);
    renderer.domElement.addEventListener('pointerup', onPointerUp, false);
    window.addEventListener('resize', onWindowResize, false);
    
    disableTouchInteractions();
    
    // 创建 AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // 创建增益节点
    gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);

    // 开始动画循环
    animate();
}

function createParticles() {
    const particleCount = 700;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const glowIntensities = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = Math.random() * 100 - 50;
        positions[i * 3 + 1] = Math.random() * 100 - 50;
        positions[i * 3 + 2] = Math.random() * 100 - 50;
        
        const colorIndex = Math.floor(i / 100);
        const color = new THREE.Color(COLORS[colorIndex]);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        
        sizes[i] = 2 + Math.random() * 1.5;
        glowIntensities[i] = 0;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('glowIntensity', new THREE.BufferAttribute(glowIntensities, 1));
    
    const vertexShader = `
        attribute float size;
        attribute vec3 color;
        attribute float glowIntensity;
        varying vec3 vColor;
        varying float vGlowIntensity;
        uniform float time;
        void main() {
            vColor = color;
            vGlowIntensity = glowIntensity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float scale = 1.0 + sin(time * 5.0) * 0.3 * glowIntensity;
            gl_PointSize = size * scale * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const fragmentShader = `
        varying vec3 vColor;
        varying float vGlowIntensity;
        void main() {
            vec2 center = gl_PointCoord - vec2(0.5);
            float dist = length(center);
            float alpha = smoothstep(0.5, 0.1, dist);
            vec3 glowColor = vec3(1.0, 1.0, 1.0);
            vec3 finalColor = mix(vColor, glowColor, vGlowIntensity * 0.8);
            gl_FragColor = vec4(finalColor, alpha * (1.0 + vGlowIntensity));
        }
    `;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    
    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

function onPointerDown(event) {
    event.preventDefault();
    isInteracting = true;
    isDragging = true;
    selectedParticles = [];
    updatePointer(event);
    checkIntersection();
}

function onPointerMove(event) {
    event.preventDefault();
    updatePointer(event);
    if (isInteracting) {
        checkIntersection();
    }
}

function onPointerUp(event) {
    event.preventDefault();
    isInteracting = false;
    isDragging = false;
    if (selectedParticles.length > 0) {
        updateNeuronLines();
        playSelectedSequence();
    }
}

function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    if (!isDragging) {
        pointerX = pointer.x;
        pointerY = pointer.y;
    }
}

function checkIntersection() {
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points.threshold = 0.5;
    
    const intersects = raycaster.intersectObject(particleSystem);
    
    if (intersects.length > 0) {
        const index = intersects[0].index;
        const glowIntensities = particleSystem.geometry.attributes.glowIntensity;
        
        if (!selectedParticles.includes(index)) {
            glowIntensities.array[index] = 1;
            selectedParticles.push(index);
            playSound(index);
            
            // 连接最后两个选中的粒子
            if (selectedParticles.length > 1) {
                const lastIndex = selectedParticles[selectedParticles.length - 1];
                const secondLastIndex = selectedParticles[selectedParticles.length - 2];
                connectParticles(secondLastIndex, lastIndex);
            }
        }
        
        glowIntensities.needsUpdate = true;
    }
}

function playSound(index) {
    const now = audioContext.currentTime;
    
    // 创建主音符
    const mainOscillator = audioContext.createOscillator();
    const mainGain = audioContext.createGain();
    
    // 创建和弦音符
    const chordOscillators = [];
    const chordGains = [];
    
    // 选择音阶中的音符
    const note = currentScale[index % currentScale.length];
    const frequency = BASE_FREQUENCY * Math.pow(2, note / 12 + 2); // 提高两个八度
    
    // 设置主音符
    mainOscillator.type = 'sine';
    mainOscillator.frequency.setValueAtTime(frequency, now);
    mainGain.gain.setValueAtTime(0, now);
    mainGain.gain.linearRampToValueAtTime(0.3, now + 0.1);
    mainGain.gain.exponentialRampToValueAtTime(0.001, now + 2);
    
    // 添加颤音效果
    const vibratoOsc = audioContext.createOscillator();
    vibratoOsc.frequency.setValueAtTime(5, now);
    const vibratoGain = audioContext.createGain();
    vibratoGain.gain.setValueAtTime(3, now);
    vibratoOsc.connect(vibratoGain);
    vibratoGain.connect(mainOscillator.frequency);
    vibratoOsc.start(now);
    vibratoOsc.stop(now + 2);

    mainOscillator.connect(mainGain);
    
    // 添加混响效果
    const convolver = audioContext.createConvolver();
    const impulseResponse = createImpulseResponse(2, 2, false);
    convolver.buffer = impulseResponse;
    mainGain.connect(convolver);
    convolver.connect(audioContext.destination);
    
    // 创建和弦
    for (let i = 0; i < 2; i++) {
        const chordOsc = audioContext.createOscillator();
        const chordGain = audioContext.createGain();
        
        const chordNote = currentScale[(index + 2 + i * 2) % currentScale.length];
        const chordFreq = BASE_FREQUENCY * Math.pow(2, chordNote / 12 + 2); // 提高两个八度
        
        chordOsc.type = 'sine';
        chordOsc.frequency.setValueAtTime(chordFreq, now);
        chordGain.gain.setValueAtTime(0, now);
        chordGain.gain.linearRampToValueAtTime(0.1, now + 0.1);
        chordGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
        
        chordOsc.connect(chordGain);
        chordGain.connect(convolver);
        
        chordOscillators.push(chordOsc);
        chordGains.push(chordGain);
    }
    
    // 开始播放所有音符
    mainOscillator.start(now);
    mainOscillator.stop(now + 2);
    chordOscillators.forEach(osc => {
        osc.start(now);
        osc.stop(now + 1.5);
    });
    
    // 存储音频节点以便后续清理
    audioNodes.push(mainOscillator, mainGain, vibratoOsc, vibratoGain, convolver, ...chordOscillators, ...chordGains);
}

function flashParticle(index) {
    const glowIntensities = particleSystem.geometry.attributes.glowIntensity;
    let flashTime = 0;
    
    function flash() {
        if (flashTime < 0.5) {
            glowIntensities.array[index] = Math.sin(flashTime * Math.PI * 4);
            glowIntensities.needsUpdate = true;
            flashTime += 0.05;
            requestAnimationFrame(flash);
        } else {
            glowIntensities.array[index] = selectedParticles.includes(index) ? 1 : 0;
            glowIntensities.needsUpdate = true;
        }
    }
    
    flash();
}

function playSelectedSequence() {
    if (isPlaying) return;
    isPlaying = true;
    
    // 在开始新的序列之前清理旧的音频节点
    cleanupAudioNodes();
    
    // 随机选择一个音阶
    currentScale = Object.values(SCALES)[Math.floor(Math.random() * Object.keys(SCALES).length)];
    
    let i = 0;
    function playNext() {
        if (i < selectedParticles.length) {
            playSound(selectedParticles[i]);
            flashParticle(selectedParticles[i]);
            i++;
            setTimeout(playNext, 500);
        } else {
            isPlaying = false;
            resetParticles();
        }
    }
    playNext();
}

function resetParticles() {
    const glowIntensities = particleSystem.geometry.attributes.glowIntensity;
    for (let i = 0; i < selectedParticles.length; i++) {
        glowIntensities.array[selectedParticles[i]] = 0;
    }
    glowIntensities.needsUpdate = true;
    selectedParticles = [];
    
    neuronLines.forEach(line => scene.remove(line));
    neuronLines = [];
}

function updateNeuronLines() {
    neuronLines.forEach(line => scene.remove(line));
    neuronLines = [];

    for (let i = 0; i < selectedParticles.length - 1; i++) {
        const startIndex = selectedParticles[i];
        const endIndex = selectedParticles[i + 1];
        
        const startPos = new THREE.Vector3(
            particleSystem.geometry.attributes.position.array[startIndex * 3],
            particleSystem.geometry.attributes.position.array[startIndex * 3 + 1],
            particleSystem.geometry.attributes.position.array[startIndex * 3 + 2]
        );
        
        const endPos = new THREE.Vector3(
            particleSystem.geometry.attributes.position.array[endIndex * 3],
            particleSystem.geometry.attributes.position.array[endIndex * 3 + 1],
            particleSystem.geometry.attributes.position.array[endIndex * 3 + 2]
        );

        const lineGeometry = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        
        scene.add(line);
        neuronLines.push(line);
    }
}

function connectParticles(index1, index2) {
    const pos1 = new THREE.Vector3(
        particleSystem.geometry.attributes.position.array[index1 * 3],
        particleSystem.geometry.attributes.position.array[index1 * 3 + 1],
        particleSystem.geometry.attributes.position.array[index1 * 3 + 2]
    );
    const pos2 = new THREE.Vector3(
        particleSystem.geometry.attributes.position.array[index2 * 3],
        particleSystem.geometry.attributes.position.array[index2 * 3 + 1],
        particleSystem.geometry.attributes.position.array[index2 * 3 + 2]
    );

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([pos1, pos2]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    
    scene.add(line);
    neuronLines.push(line);
}

function animate() {
    requestAnimationFrame(animate);
    
    particleSystem.material.uniforms.time.value = performance.now() * 0.001;
    
    if (!isDragging) {
        let rotationDirectionY = pointerX < 0 ? -1 : 1;
        let rotationDirectionX = pointerY < 0 ? -1 : 1;
        let rotationSpeedY = 0.001 + Math.abs(pointerX) * 0.1;
        let rotationSpeedX = 0.001 + Math.abs(pointerY) * 0.05;
        
        particleSystem.rotation.y += rotationSpeedY * rotationDirectionY;
        particleSystem.rotation.x += rotationSpeedX * rotationDirectionX;
    } else {
        particleSystem.rotation.y += rotationSpeed;
    }
    
    neuronLines.forEach((line, index) => {
        const startIndex = selectedParticles[index];
        const endIndex = selectedParticles[index + 1];
        
        const startPos = new THREE.Vector3(
            particleSystem.geometry.attributes.position.array[startIndex * 3],
            particleSystem.geometry.attributes.position.array[startIndex * 3 + 1],
            particleSystem.geometry.attributes.position.array[startIndex * 3 + 2]
        );
        
        const endPos = new THREE.Vector3(
            particleSystem.geometry.attributes.position.array[endIndex * 3],
            particleSystem.geometry.attributes.position.array[endIndex * 3 + 1],
            particleSystem.geometry.attributes.position.array[endIndex * 3 + 2]
        );

        startPos.applyMatrix4(particleSystem.matrixWorld);
        endPos.applyMatrix4(particleSystem.matrixWorld);

        line.geometry.setFromPoints([startPos, endPos]);
        line.geometry.verticesNeedUpdate = true;

        line.material.opacity = 0.5 + 0.5 * Math.sin(Date.now() * 0.005 + index);
    });
    
    const glowIntensities = particleSystem.geometry.attributes.glowIntensity;
    selectedParticles.forEach(index => {
        glowIntensities.array[index] = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
    });
    glowIntensities.needsUpdate = true;
    
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function disableTouchInteractions() {
    document.addEventListener('touchmove', function(e) {
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });

    document.body.style.webkitTouchCallout = 'none';
}

function cleanupAudioNodes() {
    const now = audioContext.currentTime;
    audioNodes.forEach(node => {
        if (node.stop) {
            node.stop(now);
        }
        if (node.disconnect) {
            node.disconnect();
        }
    });
    audioNodes = [];
}

function createImpulseResponse(duration, decay, reverse) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioContext.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = reverse ? length - i : i;
        left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
        right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }

    return impulse;
}

init();

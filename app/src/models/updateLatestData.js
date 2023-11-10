"use strict";


fetch('../bin/latestData')
    .then(response => response.json())
    .then(data => {
        const measurementData = data; // 데이터베이스에서 가져온 측정 데이터
        updateMeasurementValue(measurementData);
    })
    .catch(error => {
        console.error('데이터를 가져오는 중 오류 발생:', error);
    });
const WebSocket = require('ws');
const PRTG = require('node-prtg');
const axios = require('axios');
const fs = require('fs');
const moment = require('moment')

const wss = new WebSocket.Server({ port: 8080 });
console.log("Websocket Server Started.");

const prtgUsername = '{INSERT PRTG USERNAME HERE}'
const prtgPassHash = '{INSERT PRTG PASSHASH HERE}'
const prtgUrl = '{INSERT PRTG URL HERE}'

const prtgApi = new PRTG({
    url: prtgUrl,
    username: prtgUsername,
    passhash: prtgPassHash
});

//
let allDistricts = [
    "OS Main",
    "OS Campus - NE",
    "OS Campus - SE",
    "OS Campus - SW",
    "OS Campus - NW",
    "Berkley",
    "Clarenceville",
    "Clawson",
    "Ferndale",
    "Holly",
    "Lake Orion",
    "Novi",
    "Pontiac",
    "Royal Oak",
    "Southfield",
    "West Bloomfield",
]

//UPS Time Sensor ID, UPS Battery Sensor ID
let UPSSensorArray = {}

let UPSSensorData = {}
let UPSMainMenu = {
    'Statuslog': []
}

async function updateAllSensors() {
    console.log("Getting new sensor data.")
    let promises = []
    for (district in Object.keys(UPSSensorArray)) {
        let districtArray = UPSSensorArray[Object.keys(UPSSensorArray)[district]]
        let districtName = Object.keys(UPSSensorArray)[district]
        
        for (item in districtArray) {
            let currentItem = districtArray[item]

            const nextPromise = updateSensorItems(districtName, currentItem[0], currentItem[1])
            promises.push(nextPromise)
        }
    }

    //MAJOR ISSUE: Function is not waiting till await is done to call updateClientsDistrict
    await Promise.all(promises)
    let message = "["+moment().format("dddd, MMMM Do - hh:mm:ss a")+"] Updated all district sensors."
    addStatusLogItem(message, "normal")
    updateClientsDistrict()
}

const updateTimeSensor = (sensorid) => new Promise((resolve, reject) => {
    prtgApi.getSensor(sensorid).then(sensor => {
        resolve(sensor)
    }).catch(error => {
        console.log(`There was an error getting sensor ID: ${sensorid}`, error)
        reject(error)
    })
})

const updateBatterySensor = (sensorid) => new Promise((resolve, reject) => {
    axios.get('{INSERT PRTG URL}/api/table.json', {
        params: {
            id: sensorid,
            content: 'channels',
            columns: 'objid,name,lastvalue',
            username: prtgUsername,
            passhash: prtgPassHash
        }
    }).then(response => {
        let sensorData = response.data.channels.reduce((result, index) => {
            //TODO: For batteryremainingmax implementation
            // result[index.name] = {
            //     'value': index.lastvalue,
            //     'valueraw:': index.lastvalue_raw 
            // }
            result[index.name] = index.lastvalue
            return result;
        }, {})
        resolve(sensorData)
    }).catch(error => {
        console.log(`There was an error getting sensor ID: ${sensorid}`, error)
        reject(error)
    }).finally(final => { })
})

const updateSensorItems = (district, UPSTimeSensor, UPSBatterySensor) => new Promise(async (resolve, reject) => {
    //let dataCopy = UPSSensorData[district]

    UPSSensorData[district] = {
        SensorArray: [],
        UPSStandby: 0,
        UPSCharging: 0,
        UPSDischarging: 0,
        UPSDead: 0,
        UPSDisconnected: 0,
    }

    const timeSensorData = await updateTimeSensor(UPSTimeSensor)
    const batterySensorData = await updateBatterySensor(UPSBatterySensor)

    let currentDeviceName = timeSensorData.parentdevicename.split(" ")[1].replace("(", "").replace(")", "");
    let currentDeviceStatus = timeSensorData.statustext

    let currentBatteryTimeMax = {
        value: '0 s',
        valueraw: 0
    }

    if (currentDeviceStatus == "Down") { UPSSensorData[district].UPSDisconnected++ } else if (currentDeviceStatus == "Up") { UPSSensorData[district].UPSStandby++ }

    //TODO: Implement logic for batterytimemax
    // if(dataCopy != undefined) { 

    //     //console.log(dataCopy.SensorArray.filter(index => index.currentDeviceName==deviceName))
    //     if(dataCopy.SensorArray.filter(index => index.currentDeviceName==deviceName).batterytimemax.valueraw < (batterySensorData['UPS Battery Time Remaining'].valueraw || batterySensorData['Run Time Remaining'].valueraw)) {
    //         currentBatteryTimeMax = batterySensorData['UPS Battery Time Remaining'] || batterySensorData['Run Time Remaining']
    //     } else {
    //         currentBatteryTimeMax = dataCopy.SensorArray.filter(index => index.currentDeviceName==deviceName).batterytimemax
    //     }
    //  }

    UPSSensorData[district].SensorArray.push({
        'deviceName': currentDeviceName,
        'statustext': timeSensorData.statustext,
        'downtimetime': timeSensorData.downtimetime,
        'uptimetime': timeSensorData.uptimetime,
        'voltageinput': Object.keys(batterySensorData)!=0 ? (batterySensorData['UPS Input Voltage'] || batterySensorData['Input Line Voltage']) : "Not Found",
        'voltageoutput': Object.keys(batterySensorData)!=0 ? (batterySensorData['UPS Output Voltage'] || batterySensorData['Output Voltage']) : "Not Found",
        'temperature': Object.keys(batterySensorData)!=0 ? (batterySensorData['Battery Temperature'] || '') : "Not Found",
        'batterytimecurrent': Object.keys(batterySensorData)!=0 ? (batterySensorData['UPS Battery Time Remaining'] || batterySensorData['Run Time Remaining']) : "Not Found",
        'batterytimemax': currentBatteryTimeMax,
    })
    resolve()
})

wss.on('connection', (ws, req) => {
    //Alert server of client connection, then send ONLY that client what data we have for them.
    console.log("Client Connected.")

    ws.on('message', (data) => {
        let payload = JSON.parse(data)
        console.log("A client sent us a message: ", payload)

        if (payload.type == "Initial Connect") {
            ws.district = "Main Menu"
            let returnData = {
                type: "Initial Districts",
                'allDistricts': allDistricts,
                'activeDistricts': Object.keys(UPSSensorArray)
            }
            ws.send(JSON.stringify(returnData))
        } else if (payload.type == "District Update" && UPSSensorData[payload.district] != undefined) {
            ws.district = payload.district;
            let returnData = {
                type: "District Update",
                districtData: UPSSensorData[payload.district]
            }
            ws.send(JSON.stringify(returnData))
        } else if (payload.type == "Main Menu Update") {
            ws.district = "Main Menu";
            let returnData = {
                type: "Main Menu Data",
                mainmenuData: UPSMainMenu
            }
            ws.send(JSON.stringify(returnData))
        }
    })
    ws.on('close', () => {
        console.log("A Client Has Disconnected.")
    });
})

function updateClientsDistrict() {
    wss.clients.forEach((client) => {
        if (client.readyState == WebSocket.OPEN && UPSSensorData[client.district] != undefined && client.district != "Main Menu") {
            let returnData = {
                type: "District Update",
                districtData: UPSSensorData[client.district]
            }
            client.send(JSON.stringify(returnData))
        }
    });
}

function updateClientsMainMenu() {
    wss.clients.forEach((client) => {
        if (client.readyState == WebSocket.OPEN && client.district == "Main Menu") {
            let returnData = {
                type: "Main Menu Data",
                mainmenuData: UPSMainMenu
            }
            client.send(JSON.stringify(returnData))
        }
    });
}

function readSensorIDFile() {
    let rawdata = fs.readFileSync('UPSSensorIDArrays.json');
    UPSSensorArray = JSON.parse(rawdata);
}

function addStatusLogItem(message, priority) {
    UPSMainMenu.Statuslog.push({
        'message': message,
        'priority': priority
    })
    updateClientsMainMenu()
}

//On Server Start
console.log("Getting first data pull.")
readSensorIDFile()
updateAllSensors()
setInterval(updateAllSensors, 15000)
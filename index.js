const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const pjson = require('./package.json');
let connections = [];
let tocall_connection = [];
let checkers = [];

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "http://localhost:8100"); // Medtn Mobile app is running on this port.
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

/**
 * Info endpoint.
 */
app.get('/api/status/info', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    const info = {
        'name': pjson.name,
        'version': pjson.version
    };
    res.send(info)
});

app.get('/api/status/connections_Reset', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    connections = [];
    res.send('connections reset')
});

app.get('/api/status/connections/:user_key', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(io.sockets.adapter.rooms[req.params.user_key] !== undefined ?
        io.sockets.adapter.rooms[req.params.user_key]:[]);
});

app.get('/api/status/users', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    const rooms = io.sockets.adapter.rooms;
    const sids = io.sockets.adapter.sids;
    res.send(Object.entries(rooms).filter(([key, value]) => key.toString().includes('pt') || key.toString().includes('dr')));
});

io.on('connection',(socket)=>{
    console.log(`Connecté au client ${socket.id}`);

    socket.on('disconnect', async  () => {
        if(socket.user !== undefined){
            // socket.emit('disconnect_from_call');

            if(socket.user.patient !== undefined){
                // delete patient from connections array
                if(socket.user.doctor !== undefined){
                    let patient_key = 'pt'+socket.user.patient.id_patient;
                    if(connections[patient_key] !== undefined){
                        console.log('patient disconnect', patient_key);
                        if(io.sockets.adapter.rooms[patient_key] === undefined){
                            delete connections[patient_key];
                            console.log('room empty patient', patient_key);
                            if (connections['dr'+socket.user.id_doctor] !== undefined){

                                await io.to('dr'+socket.user.id_doctor).emit('user-changed', {
                                    user: socket.user,
                                    event :'patient left'
                                });
                            }
                        }
                    }
                }
            }

            // delete doctor from connections array
            else{
                if (socket.user.id_doctor !== undefined){
                    let doctor_key = 'dr'+socket.user.id_doctor;
                    console.log('disconnect_doctor', doctor_key);
                    if(io.sockets.adapter.rooms[doctor_key] === undefined){
                        console.log('room empty doctor', doctor_key);
                        //notif mes patients

                        for(var key in connections){
                            data = connections[key];
                            if (data.doctor !== undefined){
                                if(data.id_doctor === socket.user.id_doctor){
                                    await io.to('pt'+ data.patient.id_patient).emit('doctor-changed', {
                                        user: data,
                                        event :'doctor left'
                                    });
                                }
                            }
                        }
                        delete connections[doctor_key];
                    }
                }

            }
        }
    });

    socket.on('join',async (user) => {
        let patient_key = 'pt'+user.patient.id_patient;
        // console.log('patient join', patient_key);
        socket.user = user;
        //affect patient to connections array
        connections[patient_key] = user;
        //affect patient to room
        await socket.join(patient_key);
        //callback to patient that patient joined
        socket.emit('user-changed',{user: socket.user,event :'patient joined'});

        if(connections['dr'+socket.user.id_doctor] !== undefined){
            // notif my doctor
            let doctor_key = 'dr' + socket.user.id_doctor;
            if(io.sockets.adapter.rooms[patient_key].length === 1){
                //send notif to doctor that patient joined
                await io.to(doctor_key).emit('user-changed', {
                    user: socket.user,
                    event :'patient joined'
                });
            }
            //send notif to patient that doctor joined
            socket.emit('doctor-changed', {
                user: connections[doctor_key],
                event :'doctor joined'
            });
        }
    });

    socket.on('join_doctor',async (user) => {
        let data;
        if (user.id_doctor !== '') {
            let doctor_key = 'dr' + user.id_doctor;
            console.log('join_doctor', doctor_key);
            socket.user = user;
            //affect doctor to connections array
            connections[doctor_key] = user;
            //affect doctor to room
            await socket.join(doctor_key);
            console.log('rooms doctor', doctor_key, io.sockets.adapter.rooms[doctor_key].length);
            //notif mes patients
            for (let key in connections) {
                data = connections[key];
                if (data.patient !== undefined && data.id_doctor === user.id_doctor) {
                    if (io.sockets.adapter.rooms[doctor_key].length === 1) {
                        //send notif to patient that doctor joined
                        await io.to('pt' + data.patient.id_patient).emit('doctor-changed', {
                            user: data,
                            event: 'doctor joined'
                        });
                    }
                    //send notif to doctor that patient joined
                    socket.emit('user-changed', {
                        user: data,
                        event: 'patient joined'
                    });
                }
            }
        }
    });

    socket.on('make_call', async (call) => {
        let patient_key = 'pt'+ call.to.id_patient;
        if(connections[patient_key] !== undefined && call.ioSocket !== undefined) {
            console.log('make_call dr', call.ioSocket);
            //make call from doctor (socket) to patient room
            await io.to(patient_key).emit('user-call', {
                from: call.from,
                created: new Date(),
                ioSocket: call.ioSocket
            });
        }
    });

    socket.on('call_on_join', async (tele_data) => {
        let patient_key = 'pt'+ tele_data.data.patient.id_patient;
        if(connections[patient_key] !== undefined ){
            //cancel all call patient socket except sender
            await socket.to(patient_key).emit('cancel_call', {
                from: patient_key,
                created: new Date(),
                jitsi: false
            });
        }
    });

    socket.on('call_will_join', async (tele_data) => {
        let doctor_key = 'dr'+ tele_data.data.id_doctor;
        if(connections[doctor_key] !== undefined && tele_data.SenderSocket !== undefined){
            //send signal to doctor ==> patient will join
            await io.to(tele_data.SenderSocket).emit('user_will_join_call', {
                data: tele_data.data,
                created: new Date()
            });

        }
    });

    socket.on('accept_call', async (tele_data) => {
        let doctor_key = 'dr' + tele_data.data.id_doctor;
        if(connections[doctor_key] !== undefined &&
            tele_data.SenderSocket !== undefined &&
            tele_data.ReciverSocket !== undefined){
            console.log('accept_call dr',tele_data.SenderSocket ,'pt',tele_data.ReciverSocket);
            //send to specific doctor (socket) that patient accept call with (socket)
            await io.to(tele_data.SenderSocket).emit('user_accept_call', {
                data: tele_data.data,
                SenderSocket: tele_data.ReciverSocket,
                created: new Date()
            });
        }
    });

    socket.on('end_call_jitsi', async (data) => {

        if(connections[data.user] !== undefined && data.SenderSocket !== undefined) {
            console.log('end_call_jitsi',data.user, data.SenderSocket);
            //cancel call from jitsi
            await io.to(data.SenderSocket).emit('cancel_call', {
                from: data.user,
                created: new Date(),
                jitsi: data.jitsi
            });
        }
    });

    socket.on('end_call', async (data) => {
        if(connections[data.user] !== undefined && data.from !== undefined) {
            //cancel all reciver user socket call
            await io.to(data.user).emit('cancel_call', {
                from: data.user,
                created: new Date(),
                jitsi: data.jitsi
            });

            //cancel all sender user socket call except sender
            socket.to(data.from).emit('cancel_call', {
                from: data.from,
                created: new Date(),
                jitsi: false
            });
        }
    });

    socket.on('send_msg',(data) => {
        if(connections[data.user] !== undefined){
            //send msg to all user room
            io.to(data.user).emit('receive_msg', {
                from: data.from,
                msg: data.msg,
                created: new Date()
            });

            //update all sender user socket call except sender
            socket.to(data.from).emit('update_msg', {
                to: data.user,
                created: new Date(),
                msg: data.msg,
            });
        }
    });

    socket.on('jointocall',async (user) => {

        if(user !==null && user !== undefined){
            if (user.id_patient !== '') {
                let patient_key = 'pt' + user.id_patient;
                tocall_connection[patient_key] = user;
                await socket.join(patient_key);
                console.log('patient ', patient_key + ' join');
            }else {
                let doctor_key = 'dr'+user.id_doctor;
                tocall_connection[doctor_key] = user;
                console.log(io.sockets.adapter.rooms[doctor_key]);
                await socket.join(doctor_key);
                if (user.id_secretary ==='')
                    console.log('doctor ', doctor_key+ ' join');
                else
                    console.log('la secretaire st'+user.id_secretary+' du '+ doctor_key+ ' join');

                if (checkers[doctor_key] !== undefined){
                    checkers[doctor_key].map(async value => {
                        io.to(value).emit('checked',tocall_connection[doctor_key] !== undefined);
                    })
                }

            }
            socket.user = user;

            // console.log('========== connect ==========');
            // console.log(tocall_connection);
            // console.log('=============================');

        }
    });

    socket.on('disconnect_from_call', async  () => {

        if (socket.user !== undefined){
            if(socket.user.id_patient !== "") {
                let patient_key = 'pt'+socket.user.id_patient;
                delete tocall_connection[patient_key];
            } else {
                let doctor_key = 'dr'+socket.user.id_doctor;
                delete tocall_connection[doctor_key];

                if(checkers[doctor_key] === undefined)
                    console.log('no one check you ');
                else
                    console.log('disconnect',checkers[doctor_key]);

                if (checkers[doctor_key] !== undefined){
                    checkers[doctor_key].map(value => {
                        io.to(value).emit('checked',tocall_connection[doctor_key] !== undefined);
                    })
                }
            }

            // console.log('========== disconnect ==========');
            // console.log(tocall_connection);
            // console.log('================================');

            // socket.removeEventListener('jointocall');
            // socket.removeListener(call);
        }
    });

    socket.on('patient_make_call', async (call) => {
        let doctor_key = 'dr'+ call.to.id;
        if(tocall_connection[doctor_key] !== undefined && call.ioSocket !== undefined) {
            await io.to(doctor_key).emit('call-doctor', {
                from: call.from,
                created: new Date(),
                ioSocket: call.ioSocket
            });
        } else {
            console.log("doctor not connected");
        }
    });

    socket.on('patient_call_cancel', async (data) => {
        if(data.to === undefined) {
            console.log("cancelled from doctor",'pt'+data.from.id_patient);
            await io.to('pt'+data.from.id_patient).emit('call_missed',data);
        } else{
            console.log("cancelled from patient",'dr'+data.to.id);
            await io.to('dr'+data.to.id).emit('call_missed',data);
        }
    });

    socket.on('patient_call_will_join', async (tele_data) => {
        console.log(tele_data);
        io.to('pt'+tele_data.from.id_patient).emit('doctor_accept_call',tele_data);
    });

    socket.on('patient_call_disconnect', async (tele_data) => {
        console.log(tele_data);
        if(tele_data.to !== undefined)
            io.to('dr'+tele_data.to.id).emit('close_jitsi',tele_data);
        else
            io.to('pt'+tele_data.from.id_patient).emit('close_jitsi',tele_data);

        // io.to('pt'+tele_data.from.id_patient).emit('doctor_accept_call',tele_data);
    });

    socket.on('checkconnectivity',async (id)=>{
        console.log(id.checker+': please check '+id.to_check+' connectivity', tocall_connection[id.to_check] !== undefined);
        io.to(id.checker).emit('checked',tocall_connection[id.to_check] !== undefined);

        if(checkers[id.to_check] === undefined)
            checkers[id.to_check] = [id.checker];
        else{
            if (checkers[id.to_check].find(value => value === id.checker) === undefined)
                checkers[id.to_check].push(id.checker);
        }

        // console.log(checkers);
    });

    socket.on('closeChecker',async (data) =>{
        if(checkers[data.doctor] !== undefined){
            let index = checkers[data.doctor].findIndex(value => value === data.patient);
            if (index > -1)
                checkers[data.doctor].splice(index, 1);
        }
    });
});

const port = process.env.PORT || 3333;
http.listen(port,function () {
    console.log("listing in localhost "+ port);
});

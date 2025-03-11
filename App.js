import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableWithoutFeedback, Button, Alert, TouchableOpacity, Dimensions} from 'react-native';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import { BarChart } from 'react-native-chart-kit';


export default function App() {
  const [sessionData, setSessionData] = useState([])
  const [retentionDurations, setRetentionDurations] = useState([]);
  const [finished, setFinished] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('idle'); // idle, breathing, retention, pause
  const [retentionTimer, setRetentionTimer] = useState(0);
  const timerIntervalRef = useRef(null);
  const pauseTimeoutRef = useRef(null);
  const breathingSound = useRef(new Audio.Sound());
  const retentionSound = useRef(new Audio.Sound());
  const doubleTapRef = useRef(null);
  const [breathingSpeed, setBreathingSpeed] = useState(1.0)
  
  const currentPhaseRef = useRef(currentPhase);
  useEffect(() => {
    currentPhaseRef.current = currentPhase;
  }, [currentPhase]);

  const loadSessionData = async () => {
    try {
      const storedData = await AsyncStorage.getItem('breathingExerciseResults');
      if (storedData !== null) {
        const parsedData = JSON.parse(storedData);
        setSessionData(Array.isArray(parsedData) ? parsedData : [parsedData]);
      }
    } catch (error) {
      console.error("Fehler beim Laden der Session-Daten:", error);
      Alert.alert("Fehler", "Daten konnten nicht geladen werden.");
    }
  };
  
  // 2. Füge diesen useEffect hinzu, um die Daten beim App-Start zu laden
  useEffect(() => {
    loadSessionData();
  }, []);


  // Audiodateien laden
  useEffect(() => {
    const loadSounds = async () => {
      try {
        await breathingSound.current.loadAsync(require('./assets/audios/breathingAudio.mp3'));
        await retentionSound.current.loadAsync(require('./assets/audios/retentionAudio.mp3'));
      } catch (error) {
        Alert.alert("Error", "Fehler beim Laden der Audiodateien.");
      }
    };
    loadSounds();

    // Ressourcen beim Unmount freigeben
    return () => {
      breathingSound.current.unloadAsync();
      retentionSound.current.unloadAsync();
      clearInterval(timerIntervalRef.current);
    };
  }, []);

 
  const handleSaveResults = async () => {
    if (retentionDurations.length === 0) {
      Alert.alert('Fehler', 'Keine Daten zum Speichern vorhanden.');
      return;
    }
    
    const timestamp = new Date().toISOString();
    const totalTime = retentionDurations.reduce((sum, t) => sum + t, 0);
    const averageTime = totalTime / retentionDurations.length;
    
    const resultData = {
      timestamp,
      rounds: retentionDurations, // Array mit den einzelnen Runden in Sekunden
      averageRetention: averageTime, // Durchschnitt in Sekunden
    };
  
    try {
      // Bestehende Daten abrufen
      const existingDataJson = await AsyncStorage.getItem('breathingExerciseResults');
      let allResults = [];
      
      if (existingDataJson) {
        try {
          // Versuchen, die existierenden Daten zu parsen
          allResults = JSON.parse(existingDataJson);
          
          // Sicherstellen, dass es ein Array ist
          if (!Array.isArray(allResults)) {
            allResults = [allResults]; // Falls es nur ein Objekt war
          }
        } catch (parseError) {
          console.error("Fehler beim Parsen der gespeicherten Daten:", parseError);
          allResults = []; // Zurücksetzen bei Parsefehler
        }
      }
      
      // Neue Ergebnisse hinzufügen
      allResults.push(resultData);
      
      // Alle Ergebnisse speichern
      await AsyncStorage.setItem('breathingExerciseResults', JSON.stringify(allResults));
      
      // ##### NEUE ZEILE: Lade die aktualisierten Daten für den Chart #####
      await loadSessionData();
      
      Alert.alert('Erfolg', 'Ergebnisse wurden gespeichert.');
      
      // App zurücksetzen für neue Übung
      resetApp();
    } catch (error) {
      console.error("Speicherfehler:", error);
      Alert.alert('Fehler', 'Ergebnisse konnten nicht gespeichert werden.');
    }
  };

  // Funktion zum Zurücksetzen der App nach dem Speichern
  const resetApp = () => {
    setRetentionDurations([]);
    setFinished(false);
    setCurrentPhase('idle');
  };

  // Starte die Runde
  const startRound = async () => {
    setIsRunning(true);
    setCurrentPhase('breathing');
    try {
      // Breathing Audio abspielen
      await breathingSound.current.setRateAsync(breathingSpeed, true);
      await breathingSound.current.replayAsync();
      // Setze Callback für das Ende der Audio-Wiedergabe
      breathingSound.current.setOnPlaybackStatusUpdate(status => {
        if (status.didJustFinish && currentPhaseRef.current === 'breathing') {
          startRetention();
        }
      });
    } catch (error) {
      Alert.alert("Error", "Fehler beim Abspielen der breathingAudio.");
    }
  };

  // Wechselt in die Retention-Phase
  const startRetention = async () => {
    // Timer zurücksetzen
    setRetentionTimer(0);
    clearInterval(timerIntervalRef.current);
    setCurrentPhase('retention');
    try {
      await retentionSound.current.replayAsync();
      // Timer starten (aktualisiert jede Sekunde)
      timerIntervalRef.current = setInterval(() => {
        setRetentionTimer(prev => prev + 1);
      }, 1000);
    } catch (error) {
      Alert.alert("Error", "Fehler beim Abspielen der retentionAudio.");
    }
  };

  // Beendet die Retention-Phase per Doppeltap oder direkt aus der Breathing-Phase
  const handleDoubleTap = async () => {
    // Wenn in Breathing-Phase: Wechsle direkt in Retention (Frühstart)
    if (currentPhase === 'breathing') {
      try {
        await breathingSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der breathingAudio:", error);
      }
      startRetention();
      return;
    }
    // In der Retention-Phase: Beende die Phase und starte Pause
    if (currentPhase === 'retention') {
      try {
        await retentionSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der retentionAudio:", error);
      }
      clearInterval(timerIntervalRef.current);
      setRetentionDurations(prev => [...prev, retentionTimer]);
      setCurrentPhase('pause');
      pauseTimeoutRef.current = setTimeout(() => {
        // Überprüfen, ob die Session noch läuft:
        if (!isRunning) return;
        startRound();
      }, 15000);
    }
  };

  // Beendet die gesamte Session während der Breathing-Phase über den Finish-Button
  const finishSession = async () => {
    // Falls gerade in der Retention-Phase, auch die aktuelle Zeit aufzeichnen.
    if (currentPhase === 'retention') {
      try {
        await retentionSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der retentionAudio:", error);
      }
      clearInterval(timerIntervalRef.current);
      setRetentionDurations(prev => [...prev, retentionTimer]);
    } else if (currentPhase === 'breathing') {
      try {
        await breathingSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der breathingAudio:", error);
      }
    }
    else if (currentPhase === 'pause') {
      // Falls wir in der Pause sind und noch keine Runde erfasst wurde,
      // aber der retentionTimer einen Wert > 0 hat, dann erfassen wir diesen Wert.
      if (retentionDurations.length === 0 && retentionTimer > 0) {
        setRetentionDurations([retentionTimer]);
      }
    }
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }
    setIsRunning(false);
    setCurrentPhase('idle');
    setFinished(true);
  };

  // Einfacher Doppeltap-Detektor (300ms Schwelle)
  const handleTap = () => {
    const now = Date.now();
    if (doubleTapRef.current && now - doubleTapRef.current < 300) {
      handleDoubleTap();
    }
    doubleTapRef.current = now;
  };

  // Formatierung des Timers im Format MM:SS
  const formatTime = seconds => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Format time for chart display
  const formatChartTime = seconds => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  

  // Chart-Daten mit absoluten Werten
  const chartData = {
    labels: sessionData.map(session => new Date(session.timestamp).toLocaleDateString()),
    datasets: [
      {
        data: sessionData.map(session => session.averageRetention) // Konvertieren zu Minuten
      }
    ]
  };

  useKeepAwake();

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <View style={styles.container}>
      {currentPhase === 'idle' && !finished && (
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Durchschnittliche Retentionszeit</Text>
            {sessionData.length > 0 ? (
              <>
                <BarChart
                  data={chartData}
                  width={Dimensions.get('window').width - 30}
                  height={220}
                  yAxisLabel=""
                  yAxisSuffix=" s"
                  fromZero={true}
                  withInnerLines={true}
                  segments={4}
                  chartConfig={{
                    backgroundColor: "#f5f5f5",
                    backgroundGradientFrom: "#f5f5f5",
                    backgroundGradientTo: "#f5f5f5",
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
                    fillShadowGradient: '#007AFF',
                    fillShadowGradientOpacity: 0.8,
                    barPercentage: 0.7,
                    propsForVerticalLabels: {
                      fontSize: 10,
                      rotation: 0
                    },
                    propsForHorizontalLabels: {
                      fontSize: 10
                    },
                    formatYLabel: (value) => {
                      const roundedValue = Math.ceil(value / 25) * 25;
                      return roundedValue.toString();
                    }
                  }}
                  style={{
                    marginVertical: 8,
                    borderRadius: 16,
                    padding: 10
                  }}
                />
                <View style={styles.statsContainer}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Total Retention Time</Text>
                    <Text style={styles.statValue}>
                      {formatTime(sessionData.reduce((total, session) => 
                        total + session.rounds.reduce((sum, time) => sum + time, 0), 0))}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Total Breathing Cycles</Text>
                    <Text style={styles.statValue}>
                      {sessionData.reduce((total, session) => total + session.rounds.length, 0)}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.noDataText}>Keine Sessions verfügbar</Text>
            )}
          </View>
        )}


        {currentPhase === 'idle' && !finished &&(
        <View style={styles.idleContainer}>
        <Text style={styles.label}>BreathingSpeed:</Text>
        <View style={styles.optionsContainer}>
          <TouchableOpacity
            style={[
              styles.optionButton,
              breathingSpeed === 1.0 && styles.optionButtonSelected,
            ]}
            onPress={() => setBreathingSpeed(1.0)}
          >
            <Text style={[styles.optionText, breathingSpeed === 1.0 && styles.optionTextSelected]}>Normal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.optionButton,
              breathingSpeed === 1.2 && styles.optionButtonSelected,
            ]}
            onPress={() => setBreathingSpeed(1.2)}
          >
            <Text style={[styles.optionText, breathingSpeed === 1.2 && styles.optionTextSelected]}>Quick</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.startButton} onPress={startRound}>
          <Text style={styles.startButtonText}>Start</Text>
        </TouchableOpacity>
      </View>
        )}
        {isRunning && (
                 <View style={styles.finishContainer}>
                 <Button title="Finish" onPress={finishSession} />
               </View>
       
        )}
        {currentPhase === 'breathing' && (
          <View style={styles.phaseContainer}>
            <Text style={styles.phaseText}>Atme tief ein...</Text>
          </View>
        )}
        {currentPhase === 'retention' && (
          <View style={styles.phaseContainer}>
            <Text style={styles.phaseText}>Luft anhalten (Doppeltap um zu beenden)</Text>
            <Text style={styles.timerText}>{formatTime(retentionTimer)}</Text>
          </View>
        )}
        {currentPhase === 'pause' && (
          <Text style={styles.phaseText}>Pause... Nächste Runde startet in 15 Sekunden</Text>
        )}
        {finished && retentionDurations.length > 0 && (
        <View style={styles.resultsContainer}>
          {retentionDurations.map((duration, index) => (
            <Text key={index} style={styles.resultText}>
              Runde {index + 1}: {formatTime(duration)}
            </Text>
          ))}
           <TouchableOpacity style={styles.startButton} onPress={handleSaveResults}>
          <Text style={styles.startButtonText}>Save</Text>
        </TouchableOpacity>
         
        </View>
      )}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  chartContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: '#fff',
    // borderRadius: 12,
    // padding: 10,
    // shadowColor: "#000",
    // shadowOffset: {
    //   width: 0,
    //   height: 2,
    // },
    // shadowOpacity: 0.1,
    // shadowRadius: 3.84,
    // elevation: 3,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  noDataText: {
    fontSize: 16,
    color: '#999',
    fontStyle: 'italic',
    padding: 20,
  },
  phaseContainer: {
    alignItems: 'center',
  },
  phaseText: {
    fontSize: 20,
    textAlign: 'center',
    margin: 20,
  },
  timerText: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  resultsContainer: {
    marginTop: 30,
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 20,
    width: '90%',
  },
  resultText: {
    fontSize: 18,
    marginVertical: 4,
    fontWeight: '500',
  },
  finishContainer: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  idleContainer: {
    alignItems: 'center',
    marginTop: 30,
  },
  label: {
    fontSize: 18,
    marginBottom: 10,
    fontWeight: '500',
  },
  optionsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  optionButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#f1f3f5',
    borderRadius: 8,
    marginHorizontal: 8,
    borderWidth: 2,
    borderColor: '#f1f3f5',
  },
  optionButtonSelected: {
    backgroundColor: '#e7f5ff',
    borderColor: '#007AFF',
  },
  optionText: {
    fontSize: 16,
    color: '#555',
    fontWeight: '500',
  },
  optionTextSelected: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  startButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 10,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
  },
  statsContainer: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
    paddingHorizontal: 10,
  },
  statItem: {
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 10,
    width: '45%',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007AFF',
  },
});